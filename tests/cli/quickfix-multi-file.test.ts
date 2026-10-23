import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { runQuickfix } from '../../packages/cli/src/commands/quickfix.ts';
import { readActiveQuickfixLock } from '../../packages/cli/src/commands/work-channels.ts';
import { runPreCommitHook } from '../../packages/cli/src/commands/hook/pre-commit.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-quickfix-multi-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'ignore' });
const files = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
const claim = (prompt: string, scope?: string[]) => runNext([
  '--cwd', cwd, '--claim', '--actor', 'fixture-agent', '--prompt', prompt,
  ...(scope ? ['--files', scope.join(',')] : [])
]);
const release = () => runQuickfix(['release', '--cwd', cwd, '--actor', 'fixture-agent']);

try {
  git('init', '-q');
  git('config', 'user.name', 'ATM Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  mkdirSync(path.join(cwd, '.atm'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm/config.json'), JSON.stringify({
    schemaVersion: 'atm.config.v0.1', layoutVersion: 2
  }));
  mkdirSync(path.join(cwd, 'src'));
  for (const file of files) writeFileSync(path.join(cwd, file), 'export {};\n');
  git('add', '.');
  git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture base');

  // Explicit scope works without prompt paths, and overrides any prompt paths.
  for (const prompt of ['quickfix related fixtures', 'quickfix src/unrelated.ts']) {
    const result = await claim(prompt, files.slice(0, 2));
    assert.equal(result.ok, true);
    assert.deepEqual(readActiveQuickfixLock(cwd)?.allowedFiles, files.slice(0, 2));
    await release();
  }
  const inferred = await claim('quickfix src/a.ts and src/b.ts');
  assert.equal(inferred.ok, true);
  assert.deepEqual(readActiveQuickfixLock(cwd)?.allowedFiles, files.slice(0, 2));
  await release();

  // Refuse oversized explicit and inferred scopes before writing an active lock.
  for (const scope of [files.concat('src/d.ts'), undefined]) {
    await assert.rejects(() => claim('quickfix src/a.ts src/b.ts src/c.ts src/d.ts', scope),
      { code: 'ATM_QUICKFIX_FILE_LIMIT_EXCEEDED' });
    assert.equal(readActiveQuickfixLock(cwd), null);
  }

  assert.equal((await claim('quickfix related fixtures', files)).ok, true);
  assert.equal(readActiveQuickfixLock(cwd)?.maxChangedLines, 80);
  // All three files are allowed; additions plus deletions share one line budget.
  writeFileSync(path.join(cwd, files[0]), 'export {};\n' + '// fix\n'.repeat(78));
  for (const file of files.slice(1)) writeFileSync(path.join(cwd, file), 'export {};\n// fix\n');
  git('add', 'src');
  const within = runPreCommitHook(cwd);
  assert.equal(within.ok, true, JSON.stringify(within.messages));
  assert.equal(within.evidence.quickfixChangedLineCount, 80);
  writeFileSync(path.join(cwd, files[0]), 'export {};\n' + '// fix\n'.repeat(79));
  git('add', 'src');
  const over = runPreCommitHook(cwd);
  assert.equal(over.ok, false);
  assert.equal(over.evidence.quickfixLineLimitExceeded, true);
  assert.equal(over.evidence.quickfixChangedLineCount, 81);
  assert.ok(JSON.stringify(over.messages).includes('ATM_QUICKFIX_LINE_LIMIT_EXCEEDED'));
  writeFileSync(path.join(cwd, 'src/d.ts'), '// fourth file\n');
  git('add', 'src');
  const fourth = runPreCommitHook(cwd);
  assert.equal(fourth.ok, false);
  assert.equal(fourth.evidence.quickfixFileLimitExceeded, true);
  console.log('quickfix multi-file: ok');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPreCommitHook } from '../../packages/cli/src/commands/hook/pre-commit.ts';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { readActiveQuickfixLock, writeQuickfixLock } from '../../packages/cli/src/commands/work-channels.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-research-paths-'));
const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' });
git('init', '-q');
git('config', 'user.name', 'fixture');
git('config', 'user.email', 'fixture@example.invalid');
mkdirSync(path.join(cwd, '.atm'), { recursive: true });
writeFileSync(path.join(cwd, '.atm/config.json'), JSON.stringify({ schemaVersion: 'atm.config.v0.1', layoutVersion: 2 }));
const sealedFile = 'research/paper-v2/prereg-v3-smoke/old-generation/README.md';
mkdirSync(path.dirname(path.join(cwd, sealedFile)), { recursive: true });
writeFileSync(path.join(cwd, sealedFile), 'sealed evidence\n');
git('add', '.');
git('-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'seal existing generation');
const claim = (files: string[], prompt = 'Document paper research design and patch smoke kit') => runNext([
  '--cwd', cwd, '--claim', '--actor', 'fixture', '--prompt', prompt, '--files', files.join(',')
]);
const files = ['research/paper-v2/prereg-v3-kit-design/new-generation/DESIGN.md', 'research/paper-v2/EVIDENCE_INDEX.md', 'scripts/smoke-patch.sh'].sort();
const result = await claim(files);
const nextAction = result.evidence.nextAction as { status: string; playbook?: unknown };
assert.equal(nextAction.status, 'ready');
assert.deepEqual(readActiveQuickfixLock(cwd)?.allowedFiles, files);
assert.equal(readActiveQuickfixLock(cwd)?.maxChangedLines, 80);
assert.ok(nextAction.playbook);
console.log('ok - explicit research and smoke patch scope claims without magic prompt words');
for (const scope of [[sealedFile], ['research/paper-v2/prereg-v3-smoke/old-generation/new.txt'],
  ['research/paper-v2/prereg-v3-smoke/old-generation/**'], ['research/paper-v2/prereg-v3-smoke'], ['research'], ['.'], ['**'],
  ['research/paper-v2/*.md'], ['research/paper-v2/prereg-v3-smoke/new/../../prereg-v3-smoke/old-generation/README.md']]) {
  const refused = await claim(scope, 'quickfix research evidence');
  assert.equal(refused.ok, false);
  assert.ok(refused.messages.some((entry) => entry.code === 'ATM_QUICKFIX_IMMUTABLE_RESEARCH_GENERATION'));
  assert.deepEqual(readActiveQuickfixLock(cwd)?.allowedFiles, files, 'refusal must preserve existing authority');
}
console.log('ok - sealed generations reject edits, extensions, directories and globs without changing authority');
await assert.rejects(() => claim(files.concat('scripts/fourth.sh')), { code: 'ATM_QUICKFIX_FILE_LIMIT_EXCEEDED' });
assert.deepEqual(readActiveQuickfixLock(cwd)?.allowedFiles, files);
console.log('ok - four-file explicit scope still fails before lock mutation');

assert.throws(() => writeQuickfixLock({ cwd, actorId: 'fixture', prompt: 'direct claim', allowedFiles: [sealedFile] }),
  { code: 'ATM_QUICKFIX_IMMUTABLE_RESEARCH_GENERATION' });
for (const file of files) {
  mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  writeFileSync(path.join(cwd, file), '// fix\n'.repeat(file === files[0] ? 78 : 1));
}
git('add', '--', ...files);
assert.equal(runPreCommitHook(cwd).evidence.quickfixChangedLineCount, 80);
assert.equal(runPreCommitHook(cwd).ok, true);
writeFileSync(path.join(cwd, files[0]), '// fix\n'.repeat(79));
git('add', '--', ...files);
const over = runPreCommitHook(cwd);
assert.equal(over.ok, false);
assert.equal(over.evidence.quickfixLineLimitExceeded, true);
console.log('ok - direct quickfix also protects seals; research and smoke patch additions share the 80-line budget');

if (process.platform !== 'win32') {
  const alias = 'research/paper-v2/prereg-v3-kit-design/alias';
  symlinkSync(path.join(cwd, 'research/paper-v2/prereg-v3-smoke/old-generation'), path.join(cwd, alias));
  assert.equal((await claim([`${alias}/README.md`])).ok, false);
  assert.equal((await claim([path.join(cwd, sealedFile)])).ok, false);
  console.log('ok - absolute paths and symlink aliases cannot escape immutable generation checks');
}

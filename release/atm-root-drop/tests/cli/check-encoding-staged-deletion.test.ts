import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const script = path.join(repoRoot, 'scripts', 'check-encoding-touched.ts');
const source = readFileSync(script, 'utf8');

assert.match(source, /--diff-filter=ACMRTD/, 'staged and worktree readers must include D');

const fixture = mkdtempSync(path.join(os.tmpdir(), 'atm-git-0041-'));
try {
  execFileSync('git', ['init', '-q'], { cwd: fixture });
  execFileSync('git', ['config', 'user.email', 'atm@example.invalid'], { cwd: fixture });
  execFileSync('git', ['config', 'user.name', 'ATM test'], { cwd: fixture });
  writeFileSync(path.join(fixture, 'removed.txt'), 'plain text\n', 'utf8');
  execFileSync('git', ['add', 'removed.txt'], { cwd: fixture });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: fixture });
  rmSync(path.join(fixture, 'removed.txt'));
  execFileSync('git', ['add', '-u'], { cwd: fixture });

  const stagedNames = execFileSync(
    'git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRTD'],
    { cwd: fixture, encoding: 'utf8' }
  ).trim();
  assert.equal(stagedNames, 'removed.txt', 'staged deletion must be discoverable');

  const result = spawnSync(
    process.execPath,
    ['--strip-types', script, '--mode', 'staged', '--files', path.join(fixture, 'removed.txt')],
    { cwd: fixture, encoding: 'utf8' }
  );
  assert.equal(result.status, 0, `missing deleted path must be safe: ${result.stderr}`);
  assert.match(String(result.stdout), /no text files/, 'deleted path should be skipped safely');
  const missing = spawnSync(process.execPath,
    ['--strip-types', script, '--mode', 'staged', '--files', 'never-existed.txt'],
    { cwd: fixture, encoding: 'utf8' });
  assert.notEqual(missing.status, 0, 'arbitrary missing files must not silently pass');
  assert.match(missing.stderr, /not a Git deletion/);
  const discovered = spawnSync(process.execPath,
    ['--strip-types', script, '--mode', 'staged'],
    { cwd: fixture, encoding: 'utf8' });
  assert.equal(discovered.status, 0, discovered.stderr);
  // A deleted path must not suppress validation of a retained changed file.
  writeFileSync(path.join(fixture, 'retained.txt'), 'text\n');
  execFileSync('git', ['add', 'retained.txt'], { cwd: fixture });
  writeFileSync(path.join(fixture, 'atm.mjs'),
    "if (process.argv[process.argv.indexOf('--files') + 1] !== 'retained.txt') process.exit(8); process.exit(7);\n");
  const mixed = spawnSync(process.execPath,
    ['--strip-types', script, '--mode', 'staged'],
    { cwd: fixture, encoding: 'utf8' });
  assert.equal(mixed.status, 7, 'retained file must reach guard and preserve its failure');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}

console.log('TASK-GIT-0041 staged deletion encoding guard test passed');

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readStagedFiles as readCommitFiles } from '../../packages/cli/src/commands/git-governance/implementation/git-index-transaction.ts';
import { readStagedFiles as readHookFiles } from '../../packages/cli/src/commands/hook/pre-commit/input-state.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-staged-deletion-'));
const git = (...args: string[]) => execFileSync('git', args, {
  cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
});
try {
  git('init', '-q');
  git('config', 'user.name', 'ATM fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'core.hooksPath', path.join(repo, 'fixture-hooks'));
  for (const name of ['deleted.txt', 'modified.txt']) writeFileSync(path.join(repo, name), 'seed\n');
  git('add', '--', 'deleted.txt', 'modified.txt');
  git('commit', '-qm', 'seed');
  git('rm', '--', 'deleted.txt');
  for (const read of [readCommitFiles, readHookFiles]) {
    assert.deepEqual(read(repo), ['deleted.txt'], 'deletion-only index must not look empty');
  }
  writeFileSync(path.join(repo, 'modified.txt'), 'changed\n');
  writeFileSync(path.join(repo, 'added.txt'), 'added\n');
  git('add', '--', 'modified.txt', 'added.txt');
  for (const read of [readCommitFiles, readHookFiles]) {
    assert.deepEqual(read(repo), ['added.txt', 'deleted.txt', 'modified.txt']);
  }
  git('reset', '-q', 'HEAD', '--', 'deleted.txt');
  for (const read of [readCommitFiles, readHookFiles]) {
    assert.deepEqual(read(repo), ['added.txt', 'modified.txt'], 'unstaged deletion must not enter staged scope');
  }
} finally {
  rmSync(repo, { recursive: true, force: true });
}
console.log('git-staged-deletion-readers: ok');

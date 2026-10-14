import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageTaskScopedBundleFiles } from './git-index-transaction.ts';
import { estimateArgvBytes, resolvePathspecArgvBudget } from './pathspec-argv-batching.ts';
import { assembleSealedCommitIndex, readCandidateTreeEntries, readCommittedTreeEntries, sealCommitBundleFromCandidateIndex, sealCommitBundleFromLiveIndex, withWorktreeCandidateIndex } from './sealed-commit-candidate-index.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-pathspec-staging-'));
const git = (args: string[], env = process.env) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  git(['init', '-q']);
  git(['config', 'user.name', 'fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['commit', '--allow-empty', '-m', 'baseline']);
  const files = Array.from({ length: 360 }, (_, index) => `${String(index).padStart(4, '0')}-${'payload'.repeat(16)}- spaced.txt`);
  for (const file of files) writeFileSync(path.join(cwd, file), 'fixture\n', 'utf8');
  assert.ok(estimateArgvBytes(['add', '-A', '-f', '--', ...files]) > resolvePathspecArgvBudget('win32').budgetBytes);
  const env = { ...process.env, GIT_INDEX_FILE: path.join(cwd, 'candidate-index') };
  git(['read-tree', '--empty'], env);
  stageTaskScopedBundleFiles(cwd, [...files, files[0]], env);
  assert.deepEqual(git(['ls-files', '-z'], env).split('\0').filter(Boolean), files);
  const bundle = sealCommitBundleFromCandidateIndex({ cwd, paths: files, env, provenance: 'task-scope' });
  assert.equal(bundle.entries.length, files.length, 'every long-path candidate is sealed');
  const sealedBlob = bundle.entries.find(entry => entry.path === files[0])?.blobId;
  writeFileSync(path.join(cwd, files[0]), 'later worktree change\n', 'utf8');
  assembleSealedCommitIndex({ cwd, bundle, env });
  assert.equal(readCandidateTreeEntries({ cwd, env, sealedPaths: files }).length, files.length);
  assert.equal(readCandidateTreeEntries({ cwd, env, sealedPaths: files }).find(entry => entry.path === files[0])?.blobId, sealedBlob, 'assembly must retain sealed bytes rather than reread changed worktree content');
  assert.equal(sealCommitBundleFromLiveIndex({ cwd, paths: files, provenance: 'task-scope' }).entries.length, 0);
  assert.equal(readCommittedTreeEntries(cwd, 'HEAD', files).length, 0);
  withWorktreeCandidateIndex({ cwd, paths: files, run: candidateEnv => {
    assert.equal(sealCommitBundleFromCandidateIndex({ cwd, paths: files, env: candidateEnv }).entries.length, files.length);
  } });
  assert.equal(git(['ls-files', '-z']), '', 'private candidate staging must not modify the live index');
  git(['commit', '-m', 'tracked base fixture'], env);
  assembleSealedCommitIndex({ cwd, bundle, env });
  assert.equal(readCandidateTreeEntries({ cwd, env, sealedPaths: files }).length, files.length, 'inherited paths also respect the argument budget');
  assert.equal(readCommittedTreeEntries(cwd, 'HEAD', files).length, files.length);
  assert.equal(git(['ls-files', '-z']), '', 'assembling inherited entries must not modify the live index');
  console.log('task-scoped-bundle-pathspec-budget.test passed');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

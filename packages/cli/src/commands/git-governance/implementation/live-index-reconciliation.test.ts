import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { sealCommitBundle } from '../../../../../core/src/commit-attribution/sealed-commit-bundle.ts';
import { runWithSealedTaskScopedCommitIndex } from './sealed-commit-attribution.ts';

function git(cwd: string, args: readonly string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', [...args], {
    cwd,
    env: env ? { ...process.env, ...env } : process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}

function write(root: string, relative: string, content: string): void {
  const absolute = path.join(root, relative);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

function repository(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-live-index-reconcile-'));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.name', 'fixture']);
  git(root, ['config', 'user.email', 'fixture@example.com']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  write(root, 'owned.txt', 'old\n');
  write(root, 'foreign.txt', 'old foreign\n');
  git(root, ['add', '--', 'owned.txt', 'foreign.txt']);
  git(root, ['commit', '--quiet', '-m', 'baseline']);
  return root;
}

function sealedOwnedBundle(root: string, content: string) {
  write(root, 'owned.txt', content);
  const blobId = git(root, ['hash-object', '-w', '--', 'owned.txt']);
  return sealCommitBundle({ entries: [{ path: 'owned.txt', mode: '100644', blobId, provenance: 'task-scope' }] });
}

function commit(root: string, bundle: ReturnType<typeof sealedOwnedBundle>, afterCommit?: () => void) {
  return runWithSealedTaskScopedCommitIndex({
    cwd: root,
    paths: ['owned.txt'],
    provenance: 'task-scope',
    surface: 'focused regression',
    sealSource: { kind: 'sealed-bundle', bundle },
    run: (env) => {
      git(root, ['commit', '--quiet', '-m', 'task commit'], env);
      afterCommit?.();
    }
  });
}

{
  const root = repository();
  try {
    write(root, 'foreign.txt', 'staged foreign\n');
    git(root, ['add', '--', 'foreign.txt']);
    const foreignBlob = git(root, ['rev-parse', ':foreign.txt']);
    git(root, ['update-index', '--force-remove', '--', 'owned.txt']);

    const outcome = commit(root, sealedOwnedBundle(root, 'committed\n'));

    assert.deepEqual(outcome.liveIndexReconciliation.reconciledPaths, ['owned.txt']);
    assert.deepEqual(outcome.liveIndexReconciliation.retainedPaths, []);
    assert.equal(git(root, ['diff', '--cached', '--name-only', '--', 'owned.txt']), '');
    assert.equal(git(root, ['rev-parse', ':foreign.txt']), foreignBlob, 'foreign staged bytes must survive');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = repository();
  try {
    git(root, ['update-index', '--force-remove', '--', 'owned.txt']);
    const concurrentBlob = git(root, ['hash-object', '-w', '--stdin'], undefined).trim();
    const outcome = commit(root, sealedOwnedBundle(root, 'committed\n'), () => {
      git(root, ['update-index', '--add', '--cacheinfo', `100644,${concurrentBlob},owned.txt`]);
    });

    assert.deepEqual(outcome.liveIndexReconciliation.reconciledPaths, []);
    assert.deepEqual(outcome.liveIndexReconciliation.retainedPaths, [
      { path: 'owned.txt', reason: 'concurrent-index-change' }
    ]);
    assert.equal(git(root, ['rev-parse', ':owned.txt']), concurrentBlob, 'concurrent index bytes must survive');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

{
  const root = repository();
  try {
    git(root, ['update-index', '--force-remove', '--', 'owned.txt']);
    const outcome = commit(root, sealedOwnedBundle(root, 'committed\n'), () => {
      write(root, 'owned.txt', 'new worktree bytes\n');
    });

    assert.deepEqual(outcome.liveIndexReconciliation.reconciledPaths, []);
    assert.deepEqual(outcome.liveIndexReconciliation.retainedPaths, [
      { path: 'owned.txt', reason: 'worktree-diverged' }
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

console.log('[live-index-reconciliation] ok');

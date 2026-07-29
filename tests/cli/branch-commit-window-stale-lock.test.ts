import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  branchCommitQueueStaleSelfHealMs,
  maybeCleanupStaleBranchCommitQueueLock
} from '../../packages/cli/src/commands/git-governance/implementation/branch-commit-window.ts';

const cwd = mkdtempSync(path.join(tmpdir(), 'atm-branch-queue-stale-lock-'));
const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', 'git-commit-queue-refs-heads-main.lock');
const headSha = 'a'.repeat(40);

function writeLock(input: { actorId: string; ownerPid: number; ageMs: number }): void {
  mkdirSync(lockPath, { recursive: true });
  writeFileSync(path.join(lockPath, 'record.json'), `${JSON.stringify({
    schemaId: 'atm.branchCommitQueueLock.v1',
    specVersion: '0.1.0',
    actorId: input.actorId,
    taskId: null,
    sessionId: null,
    branchRef: 'refs/heads/main',
    branchName: 'main',
    headShaAtAcquire: headSha,
    ownerPid: input.ownerPid,
    createdAt: new Date(Date.now() - input.ageMs).toISOString()
  })}\n`, 'utf8');
}

try {
  // A dead owner is recoverable after the safety window even when the failed
  // commit left HEAD untouched, and the retrying actor need not match it.
  const exitedOwner = spawnSync(process.execPath, ['--version'], { encoding: 'utf8' });
  assert.equal(exitedOwner.status, 0);
  assert.ok(exitedOwner.pid);
  writeLock({ actorId: 'previous-writer', ownerPid: exitedOwner.pid, ageMs: branchCommitQueueStaleSelfHealMs + 1 });
  assert.equal(maybeCleanupStaleBranchCommitQueueLock({ cwd, lockPath, actorId: 'retrying-writer', currentHeadSha: headSha }), true);
  assert.equal(existsSync(lockPath), false);

  // A dead lock is not reclaimed before the safety window expires.
  writeLock({ actorId: 'previous-writer', ownerPid: -1, ageMs: branchCommitQueueStaleSelfHealMs - 1_000 });
  assert.equal(maybeCleanupStaleBranchCommitQueueLock({ cwd, lockPath, actorId: 'retrying-writer', currentHeadSha: headSha }), false);
  assert.equal(existsSync(lockPath), true);

  console.log('branch-commit-window-stale-lock.test.ts passed');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

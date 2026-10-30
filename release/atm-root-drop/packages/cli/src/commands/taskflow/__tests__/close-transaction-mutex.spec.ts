import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  acquireCloseTransactionMutex,
  closeTransactionMutexPath,
  CLOSE_TRANSACTION_MUTEX_SAFETY_MARGIN_MS,
  DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS,
  GOVERNED_GIT_COMMIT_DEFAULT_TIMEOUT_MS,
  releaseCloseTransactionMutex,
  renewCloseTransactionMutex,
  assertActiveCloseLease,
  withCloseTransactionMutex
} from '../close-transaction-mutex.ts';

const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-close-mutex-'));

try {
  assert.equal(GOVERNED_GIT_COMMIT_DEFAULT_TIMEOUT_MS, 420_000);
  assert.equal(CLOSE_TRANSACTION_MUTEX_SAFETY_MARGIN_MS, 30_000);
  assert.ok(
    DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS >= GOVERNED_GIT_COMMIT_DEFAULT_TIMEOUT_MS + CLOSE_TRANSACTION_MUTEX_SAFETY_MARGIN_MS,
    'close transaction mutex TTL must cover the governed git commit timeout plus a safety margin'
  );

  const lease = acquireCloseTransactionMutex({
    repoRoot,
    taskId: 'TASK-MUTEX-DEFAULT',
    actorId: 'validator',
    nowMs: 1_784_100_000_000
  });
  assert.equal(lease.ttlMs, DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS);
  assert.match(lease.ttlReason, /governed git commit timeout/);
  assert.equal(
    new Date(lease.expiresAt).getTime() - new Date(lease.acquiredAt).getTime(),
    DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS
  );
  const persistedLease = JSON.parse(readFileSync(lease.lockPath, 'utf8')) as { ttlMs?: number; ttlReason?: string };
  assert.equal(persistedLease.ttlMs, DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS);
  assert.match(String(persistedLease.ttlReason), /safety margin/);

  assert.throws(
    () => acquireCloseTransactionMutex({
      repoRoot,
      taskId: 'TASK-MUTEX-DEFAULT',
      actorId: 'other-validator',
      nowMs: 1_784_100_001_000
    }),
    /already held/,
    'a live close mutex must still block a second closer'
  );
  releaseCloseTransactionMutex(lease);
  assert.equal(existsSync(lease.lockPath), false, 'release must remove the active mutex lease');

  const expiredTaskId = 'TASK-MUTEX-EXPIRED';
  const expiredPath = closeTransactionMutexPath(repoRoot, expiredTaskId);
  writeFileSync(expiredPath, `${JSON.stringify({
    schemaId: 'atm.closeTransactionMutexLease.v1',
    taskId: expiredTaskId,
    actorId: 'expired-owner',
    leaseId: 'expired-lease',
    ownerPid: process.pid,
    acquiredAt: new Date(1_784_100_000_000).toISOString(),
    expiresAt: new Date(1_784_100_001_000).toISOString(),
    ttlMs: 1_000,
    ttlReason: 'test fixture',
    lockPath: expiredPath
  }, null, 2)}\n`, 'utf8');
  assert.throws(() => acquireCloseTransactionMutex({ repoRoot, taskId: expiredTaskId, actorId: 'validator', nowMs: 1_784_100_002_000 }), /already held/, 'a live PID remains valid despite heartbeat expiry, just as in recovery');
  rmSync(expiredPath);
  writeFileSync(expiredPath, JSON.stringify({ taskId: expiredTaskId, leaseId: 'legacy-pidless', actorId: 'legacy', acquiredAt: new Date(1_784_100_000_000).toISOString(), expiresAt: new Date(1_784_100_001_000).toISOString() }));
  const reclaimed = acquireCloseTransactionMutex({ repoRoot, taskId: expiredTaskId, actorId: 'validator', nowMs: 1_784_100_122_000 });
  releaseCloseTransactionMutex(reclaimed);

  const deadOwnerTaskId = 'TASK-MUTEX-DEAD';
  const deadOwnerPath = closeTransactionMutexPath(repoRoot, deadOwnerTaskId);
  writeFileSync(deadOwnerPath, `${JSON.stringify({
    schemaId: 'atm.closeTransactionMutexLease.v1',
    taskId: deadOwnerTaskId,
    actorId: 'dead-owner',
    leaseId: 'close-TASK-MUTEX-DEAD-1784100000000-99999999',
    ownerPid: 99_999_999,
    acquiredAt: new Date(1_784_100_000_000).toISOString(),
    expiresAt: new Date(2_999_000_000_000).toISOString(),
    ttlMs: DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS,
    ttlReason: 'test fixture',
    lockPath: deadOwnerPath
  }, null, 2)}\n`, 'utf8');
  const recovered = acquireCloseTransactionMutex({
    repoRoot,
    taskId: deadOwnerTaskId,
    actorId: 'validator',
    nowMs: 1_784_100_002_000
  });
  assert.equal(recovered.actorId, 'validator', 'dead owner close mutex must be recoverable before TTL expiry');
  releaseCloseTransactionMutex(recovered);

  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  await withCloseTransactionMutex({ repoRoot, taskId: 'HEARTBEAT', actorId: 'validator', ttlMs: 1000 }, async (heartbeat) => {
    await wait(1250);
    const record = JSON.parse(readFileSync(heartbeat.lockPath, 'utf8'));
    assert.ok(Date.parse(record.expiresAt) > Date.parse(heartbeat.expiresAt), 'heartbeat extends a long-running lease');
    await withCloseTransactionMutex({ repoRoot, taskId: 'HEARTBEAT', actorId: 'validator' }, (nested) => assert.equal(nested.leaseId, heartbeat.leaseId));
    assertActiveCloseLease();
  });
  const { candidateGit } = await import('../../git-governance/implementation/candidate-file-policy.ts');
  const { writeCloseTransactionStatus } = await import('../close-transaction-status.ts');
  const { releaseCloseWindowStagedIndexLock } = await import('../../tasks/close-window-lock.ts');
  const { writeTaskDocumentWithTransition } = await import('../../tasks/close-helpers/task-transition-writer.ts');
  let replacement = '', replacedPath = '';
  await assert.rejects(withCloseTransactionMutex({ repoRoot, taskId: 'LOST', actorId: 'validator' }, async (original) => {
    replacedPath = original.lockPath;
    replacement = JSON.stringify({ ...original, leaseId: 'newer-holder' });
    writeFileSync(original.lockPath, replacement);
    assert.throws(() => renewCloseTransactionMutex(original), /ATM_CLOSE_LEASE_LOST/);
    assert.throws(() => candidateGit(repoRoot, ['status']), /ATM_CLOSE_LEASE_LOST/);
    assert.throws(() => writeCloseTransactionStatus({ cwd: repoRoot, taskId: 'LOST', phase: 'ledger-written' }), /ATM_CLOSE_LEASE_LOST/);
    assert.throws(() => releaseCloseWindowStagedIndexLock({ cwd: repoRoot, taskId: 'LOST', actorId: 'validator', outcome: 'aborted' }), /ATM_CLOSE_LEASE_LOST/);
    assert.throws(() => writeTaskDocumentWithTransition({ cwd: repoRoot, taskId: 'LOST', taskPath: 'must-not-write.json', taskDocument: {}, action: 'close', actorId: 'validator', previousStatus: 'running' }), /ATM_CLOSE_LEASE_LOST/);
  }), /ATM_CLOSE_LEASE_LOST/);
  assert.equal(readFileSync(replacedPath, 'utf8'), replacement, 'lost owner never renews or removes replacement token');
  assert.equal(existsSync(path.join(repoRoot, '.atm/runtime/close-transactions/LOST.json')), false);
  rmSync(replacedPath);

  const old = acquireCloseTransactionMutex({ repoRoot, taskId: 'REACQUIRE', actorId: 'validator' });
  releaseCloseTransactionMutex(old);
  const newer = acquireCloseTransactionMutex({ repoRoot, taskId: 'REACQUIRE', actorId: 'validator' });
  releaseCloseTransactionMutex(old);
  assert.equal(JSON.parse(readFileSync(newer.lockPath, 'utf8')).leaseId, newer.leaseId, 'an older finally cannot release a later kernel holder');
  releaseCloseTransactionMutex(newer);

  const ready = path.join(repoRoot, 'holder-ready');
  const script = path.join(repoRoot, 'holder.mjs');
  writeFileSync(script, `import { writeFileSync } from 'node:fs';
import { acquireCloseTransactionMutex } from ${JSON.stringify(new URL('../close-transaction-mutex.ts', import.meta.url).href)};
acquireCloseTransactionMutex({repoRoot: ${JSON.stringify(repoRoot)}, taskId: 'PROCESS', actorId: 'child'});
writeFileSync(${JSON.stringify(ready)}, 'ready');
setInterval(() => {}, 1000);`);
  const child = spawn(process.execPath, ['--strip-types', script], { stdio: 'ignore' });
  try {
    const deadline = Date.now() + 10_000;
    while (!existsSync(ready)) { assert.ok(Date.now() < deadline); await wait(20); }
    assert.throws(() => acquireCloseTransactionMutex({ repoRoot, taskId: 'PROCESS', actorId: 'competitor' }), /already held/);
    child.kill('SIGKILL');
    await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    const afterKill = acquireCloseTransactionMutex({ repoRoot, taskId: 'PROCESS', actorId: 'recovery' });
    releaseCloseTransactionMutex(afterKill);
  } finally { child.kill('SIGKILL'); }

  console.log('[close-transaction-mutex.spec] ok');
} finally {
  rmSync(repoRoot, { recursive: true, force: true });
}

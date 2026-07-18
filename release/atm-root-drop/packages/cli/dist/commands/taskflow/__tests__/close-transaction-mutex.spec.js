import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireCloseTransactionMutex, closeTransactionMutexPath, CLOSE_TRANSACTION_MUTEX_SAFETY_MARGIN_MS, DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS, GOVERNED_GIT_COMMIT_DEFAULT_TIMEOUT_MS, releaseCloseTransactionMutex } from '../close-transaction-mutex.js';
const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-close-mutex-'));
try {
    assert.equal(GOVERNED_GIT_COMMIT_DEFAULT_TIMEOUT_MS, 420_000);
    assert.equal(CLOSE_TRANSACTION_MUTEX_SAFETY_MARGIN_MS, 30_000);
    assert.ok(DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS >= GOVERNED_GIT_COMMIT_DEFAULT_TIMEOUT_MS + CLOSE_TRANSACTION_MUTEX_SAFETY_MARGIN_MS, 'close transaction mutex TTL must cover the governed git commit timeout plus a safety margin');
    const lease = acquireCloseTransactionMutex({
        repoRoot,
        taskId: 'TASK-MUTEX-DEFAULT',
        actorId: 'validator',
        nowMs: 1_784_100_000_000
    });
    assert.equal(lease.ttlMs, DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS);
    assert.match(lease.ttlReason, /governed git commit timeout/);
    assert.equal(new Date(lease.expiresAt).getTime() - new Date(lease.acquiredAt).getTime(), DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS);
    const persistedLease = JSON.parse(readFileSync(lease.lockPath, 'utf8'));
    assert.equal(persistedLease.ttlMs, DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS);
    assert.match(String(persistedLease.ttlReason), /safety margin/);
    assert.throws(() => acquireCloseTransactionMutex({
        repoRoot,
        taskId: 'TASK-MUTEX-DEFAULT',
        actorId: 'other-validator',
        nowMs: 1_784_100_001_000
    }), /already held/, 'a live close mutex must still block a second closer');
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
    const reclaimed = acquireCloseTransactionMutex({
        repoRoot,
        taskId: expiredTaskId,
        actorId: 'validator',
        nowMs: 1_784_100_002_000
    });
    assert.equal(reclaimed.actorId, 'validator', 'expired close mutex must be reclaimable');
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
    console.log('[close-transaction-mutex.spec] ok');
}
finally {
    rmSync(repoRoot, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applySharedSurfaceQueueTransaction,
  diagnoseStaleSharedSurfaceIntents,
  type SharedSurfaceQueueEntry
} from '../../packages/core/src/broker/shared-surface-queue.ts';
import {
  loadRegistry,
  registerIntent,
  saveRegistry
} from '../../packages/core/src/broker/registry.ts';

function entry(taskId: string, epoch: number, queuedAt: string): SharedSurfaceQueueEntry {
  return {
    taskId,
    actorId: `actor-${taskId}`,
    surfacePath: 'packages/core/src/broker/shared.ts',
    leaseEpoch: epoch,
    baseHash: 'base-a',
    reason: 'shadow-first barrier',
    releaseCondition: 'composer receipt',
    queuedAt
  };
}

const first = applySharedSurfaceQueueTransaction({
  queues: [],
  entries: [entry('ATM-GOV-0138', 1, '2026-07-14T00:00:00.000Z')],
  transactionId: 'txn-1',
  createdAt: '2026-07-14T00:00:01.000Z'
});

assert.equal(first.ok, true);
assert.equal(first.transaction.status, 'committed');
assert.equal(first.queues[0].entries[0].taskId, 'ATM-GOV-0138');

const replay = applySharedSurfaceQueueTransaction({
  queues: first.queues,
  entries: [entry('ATM-GOV-0138', 1, '2026-07-14T00:00:00.000Z')],
  transactionId: 'txn-1-replay',
  createdAt: '2026-07-14T00:00:02.000Z'
});

assert.equal(replay.ok, true);
assert.equal(replay.transaction.status, 'idempotent-replay');
assert.equal(replay.transaction.baseQueueDigest, replay.transaction.nextQueueDigest);

const waiting = applySharedSurfaceQueueTransaction({
  queues: first.queues,
  entries: [entry('ATM-GOV-0139', 2, '2026-07-14T00:00:03.000Z')],
  transactionId: 'txn-2'
});

assert.equal(waiting.ok, true);
assert.deepEqual(waiting.transaction.barrierConflicts, [{
  surfacePath: 'packages/core/src/broker/shared.ts',
  queueHeadTaskId: 'ATM-GOV-0138'
}]);
assert.match(waiting.transaction.recoveryHint ?? '', /Shadow-first Team/);

const mismatch = applySharedSurfaceQueueTransaction({
  queues: first.queues,
  entries: [{ ...entry('ATM-GOV-0140', 3, '2026-07-14T00:00:04.000Z'), baseHash: 'base-b' }],
  transactionId: 'txn-3'
});

assert.equal(mismatch.ok, false);
assert.equal(mismatch.transaction.status, 'blocked');
assert.match(mismatch.transaction.recoveryHint ?? '', /different base hashes/);

const stale = diagnoseStaleSharedSurfaceIntents({
  queues: waiting.queues,
  now: '2026-07-14T01:00:00.000Z',
  staleAfterMs: 1000
});

assert.equal(stale.find((item) => item.taskId === 'ATM-GOV-0138')?.releaseable, false);
assert.equal(stale.find((item) => item.taskId === 'ATM-GOV-0139')?.releaseable, true);

const registryDir = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-registry-'));
try {
  const registryPath = path.join(registryDir, 'write-broker.registry.json');
  const base = loadRegistry(registryPath);
  const saved = registerIntent(base, {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'registry transaction fixture' },
    taskId: 'ATM-GOV-0138',
    actorId: 'captain-a',
    baseCommit: 'base-commit',
    targetFiles: ['packages/core/src/broker/registry.ts'],
    atomRefs: [],
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: ['write-broker.registry.json'],
      validators: [],
      artifacts: []
    },
    requestedLane: 'serial'
  }, 'serial');
  saveRegistry(registryPath, saved);
  const persisted = JSON.parse(readFileSync(registryPath, 'utf8'));
  assert.equal(persisted.schemaId, 'atm.writeBrokerRegistry.v1');
  assert.equal(persisted.activeIntents[0].taskId, 'ATM-GOV-0138');
  assert.deepEqual(
    readdirSync(registryDir).filter((entryName) => entryName.includes('.tmp-')),
    [],
    'atomic registry write must not leave temporary files after commit'
  );
} finally {
  rmSync(registryDir, { recursive: true, force: true });
}

console.log('[broker-registry-transaction] ok');

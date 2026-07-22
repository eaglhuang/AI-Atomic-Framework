import assert from 'node:assert/strict';
import {
  enqueueRunnerSyncStewardRequest,
  explainRunnerSyncStewardPosition
} from '../../packages/core/src/broker/runner-sync-steward-queue.ts';

const taskId = 'TASK-HEAD-MOVEMENT';
const actorId = 'captain-head-movement';
const sourceA = 'a'.repeat(40);
const sourceB = 'b'.repeat(40);

const first = enqueueRunnerSyncStewardRequest(null, {
  taskId,
  actorId,
  sealedSourceSha: sourceA,
  requestedSurfaces: ['release/atm-onefile/atm.mjs'],
  createdAt: '2026-07-21T00:00:00.000Z',
  heartbeatAt: '2026-07-21T00:00:00.000Z',
  ttlSeconds: 420
});

const second = enqueueRunnerSyncStewardRequest(first.queue, {
  taskId,
  actorId,
  sealedSourceSha: sourceB,
  requestedSurfaces: ['release/atm-root-drop/atm.mjs'],
  createdAt: '2026-07-21T00:00:01.000Z',
  heartbeatAt: '2026-07-21T00:00:01.000Z',
  ttlSeconds: 420
});

assert.equal(second.status, 'queue-head');
assert.equal(second.queue.groups.length, 1);
assert.equal(second.queue.groups[0].sealedSourceSha, sourceB);
assert.equal(second.queue.groups[0].queuePosition, 1);
assert.deepEqual(second.queue.groups[0].waitingTasks, [taskId]);

const position = explainRunnerSyncStewardPosition(second.queue, taskId, '2026-07-21T00:00:02.000Z');
assert.equal(position?.sealedSourceSha, sourceB);
assert.equal(position?.queuePosition, 1);

console.log('[runner-sync-head-movement.test] ok');

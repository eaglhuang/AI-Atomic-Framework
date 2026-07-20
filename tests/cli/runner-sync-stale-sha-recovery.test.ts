import assert from 'node:assert/strict';
import {
  cleanupRunnerSyncStewardQueue,
  enqueueRunnerSyncStewardRequest
} from '../../packages/core/src/broker/runner-sync-steward-queue.ts';

const staleSha = '1'.repeat(40);
const currentSha = '2'.repeat(40);
const enqueued = enqueueRunnerSyncStewardRequest(null, {
  taskId: 'TASK-STALE-SHA',
  actorId: 'captain.with/special:id',
  sealedSourceSha: staleSha,
  requestedSurfaces: ['release/atm-onefile/atm.mjs'],
  heartbeatAt: '2026-07-20T00:00:00.000Z',
  ttlSeconds: 1
});

const cleanup = cleanupRunnerSyncStewardQueue(enqueued.queue, '2026-07-20T00:01:00.000Z');

assert.equal(cleanup.staleReleases.length, 1);
assert.equal(cleanup.staleReleases[0].sealedSourceSha, staleSha);
assert.match(cleanup.staleReleases[0].safeRetryCommand, /--sealed-source-sha HEAD/);
assert.doesNotMatch(cleanup.staleReleases[0].safeRetryCommand, new RegExp(staleSha));
assert.doesNotMatch(cleanup.staleReleases[0].safeRetryCommand, new RegExp(currentSha));
assert.match(cleanup.staleReleases[0].safeRetryCommand, /--actor "captain.with\/special:id"/);
assert.match(cleanup.staleReleases[0].safeRetryCommand, /^node atm\.mjs broker runner-sync enqueue /);

console.log('[runner-sync-stale-sha-recovery.test] ok');

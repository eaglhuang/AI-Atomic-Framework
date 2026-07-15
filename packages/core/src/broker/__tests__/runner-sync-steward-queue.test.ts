import assert from 'node:assert/strict';
import {
  cleanupRunnerSyncStewardQueue,
  emptyRunnerSyncStewardQueue,
  enqueueRunnerSyncStewardRequest,
  explainRunnerSyncStewardPosition
} from '../runner-sync-steward-queue.ts';
import { RUNNER_SYNC_STEWARD_GENERATOR } from '../global-resource-projection.ts';

const t0 = '2026-07-15T00:00:00.000Z';

function testSameSealedSourceCoalesces() {
  let queue = emptyRunnerSyncStewardQueue(t0);
  const first = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-A',
    actorId: 'captain-a',
    sealedSourceSha: 'sha256:source-a',
    requestedSurfaces: ['release/atm-onefile/atm.mjs'],
    createdAt: t0,
    heartbeatAt: t0,
    ttlSeconds: 420
  });
  queue = first.queue;
  const second = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-B',
    actorId: 'captain-b',
    sealedSourceSha: 'sha256:source-a',
    requestedSurfaces: ['release/atm-root-drop/release-manifest.json'],
    createdAt: '2026-07-15T00:00:01.000Z',
    heartbeatAt: '2026-07-15T00:00:01.000Z',
    ttlSeconds: 420
  });

  assert.equal(second.status, 'queue-head');
  assert.equal(second.queue.groups.length, 1);
  assert.equal(second.queue.groups[0].stewardWorkId, first.stewardWorkId);
  assert.deepEqual(second.queue.groups[0].waitingTasks, ['TASK-A', 'TASK-B']);
  assert.deepEqual(second.queue.groups[0].requestedSurfaces, [
    'release/atm-onefile/atm.mjs',
    'release/atm-root-drop/release-manifest.json'
  ]);
  assert.ok(second.suggestedNextAction.includes('Run one runner-sync build'));
  console.log('ok: runner-sync requests with the same sealed source coalesce under one steward work item');
}

function testDifferentSealedSourcesStayOrdered() {
  let queue = emptyRunnerSyncStewardQueue(t0);
  const first = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-A',
    actorId: 'captain-a',
    sealedSourceSha: 'sha256:source-a',
    requestedSurfaces: ['release/atm-onefile/atm.mjs'],
    createdAt: t0,
    heartbeatAt: t0
  });
  queue = first.queue;
  const second = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-C',
    actorId: 'captain-c',
    sealedSourceSha: 'sha256:source-c',
    requestedSurfaces: ['release/atm-root-drop/atm.mjs'],
    createdAt: '2026-07-15T00:00:02.000Z',
    heartbeatAt: '2026-07-15T00:00:02.000Z'
  });

  assert.equal(second.status, 'waiting-different-source');
  assert.equal(second.queue.groups.length, 2);
  assert.equal(second.queue.groups[0].sealedSourceSha, 'sha256:source-a');
  assert.equal(second.queue.groups[1].sealedSourceSha, 'sha256:source-c');
  assert.equal(second.queue.groups[1].queuePosition, 2);
  assert.ok(second.suggestedNextAction.includes('queue position 2'));
  console.log('ok: runner-sync requests for different sealed sources remain ordered');
}

function testStaleOwnerCleanupReleasesExpiredRequests() {
  let queue = emptyRunnerSyncStewardQueue(t0);
  queue = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-STALE',
    actorId: 'stale-captain',
    sealedSourceSha: 'sha256:stale',
    requestedSurfaces: ['release/atm-onefile/atm.mjs'],
    createdAt: t0,
    heartbeatAt: t0,
    ttlSeconds: 1
  }).queue;
  queue = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-LIVE',
    actorId: 'live-captain',
    sealedSourceSha: 'sha256:live',
    requestedSurfaces: ['release/atm-root-drop/atm.mjs'],
    createdAt: '2026-07-15T00:00:02.000Z',
    heartbeatAt: '2026-07-15T00:00:02.000Z',
    ttlSeconds: 420
  }).queue;

  const cleanup = cleanupRunnerSyncStewardQueue(queue, '2026-07-15T00:00:03.000Z');
  assert.equal(cleanup.staleReleases.length, 1);
  assert.equal(cleanup.staleReleases[0].taskId, 'TASK-STALE');
  assert.equal(cleanup.staleReleases[0].queuePosition, 1);
  assert.ok(cleanup.staleReleases[0].safeRetryCommand.includes('broker runner-sync enqueue'));
  assert.equal(cleanup.queue.groups.length, 1);
  assert.equal(cleanup.queue.groups[0].queuePosition, 1);
  assert.equal(cleanup.queue.groups[0].sealedSourceSha, 'sha256:live');
  console.log('ok: expired runner-sync owners are released with safe retry diagnostics');
}

function testCliFacingJsonShape() {
  const result = enqueueRunnerSyncStewardRequest(emptyRunnerSyncStewardQueue(t0), {
    taskId: 'ATM-GOV-0150',
    actorId: 'codex-gpt-5-5-captain',
    sealedSourceSha: 'sha256:abc',
    requestedSurfaces: ['release/atm-onefile/atm.mjs'],
    createdAt: t0,
    heartbeatAt: t0
  });
  const explained = explainRunnerSyncStewardPosition(result.queue, 'ATM-GOV-0150', t0);
  assert.equal(result.schemaId, 'atm.runnerSyncStewardQueueResult.v1');
  assert.equal(result.stewardKey, RUNNER_SYNC_STEWARD_GENERATOR);
  assert.equal(result.queue.schemaId, 'atm.runnerSyncStewardQueue.v1');
  assert.equal(explained?.queuePosition, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result)).queue.groups[0].waitingTasks, ['ATM-GOV-0150']);
  console.log('ok: runner-sync steward queue exposes stable CLI-facing JSON');
}

testSameSealedSourceCoalesces();
testDifferentSealedSourcesStayOrdered();
testStaleOwnerCleanupReleasesExpiredRequests();
testCliFacingJsonShape();

console.log('all runner-sync steward queue tests passed');

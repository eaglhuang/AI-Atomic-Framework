import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  emptyRunnerSyncStewardQueue,
  enqueueRunnerSyncStewardRequest
} from '../../packages/core/src/broker/runner-sync-steward-queue.ts';
import {
  emptyGeneratedProjectionSteward,
  enqueueGeneratedProjectionRebuild
} from '../../packages/core/src/broker/generated-projection-steward.ts';
import { evaluateTaskflowBranchCommitQueueGate } from '../../packages/cli/src/commands/taskflow/branch-commit-queue-gate.ts';
import { buildTaskflowCommitBatchEvidence } from '../../packages/cli/src/commands/taskflow/commit-bundle-assembly.ts';

const t0 = '2026-07-18T00:00:00.000Z';

function testRunnerSyncSameWaveBatches() {
  let queue = emptyRunnerSyncStewardQueue(t0);
  queue = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-A',
    actorId: 'agent-a',
    sealedSourceSha: 'sha-wave',
    requestedSurfaces: ['release/atm-onefile/atm.mjs'],
    waveId: 'wave-1',
    surfaceFamily: 'release',
    validators: ['npm run build'],
    createdAt: t0,
    heartbeatAt: t0
  }).queue;
  const second = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-B',
    actorId: 'agent-b',
    sealedSourceSha: 'sha-wave',
    requestedSurfaces: ['release/atm-root-drop/release-manifest.json'],
    waveId: 'wave-1',
    surfaceFamily: 'release',
    validators: ['npm run typecheck'],
    createdAt: '2026-07-18T00:00:01.000Z',
    heartbeatAt: '2026-07-18T00:00:01.000Z'
  });

  assert.equal(second.queue.groups.length, 1);
  assert.equal(second.brokerTicket.batchEligible, true);
  assert.equal(second.brokerTicket.waveId, 'wave-1');
  assert.equal(second.brokerTicket.surfaceFamily, 'release');
  assert.deepEqual(second.brokerTicket.batch?.taskIds, ['TASK-A', 'TASK-B']);
  assert.deepEqual(second.brokerTicket.batch?.validators, ['npm run build', 'npm run typecheck']);
  assert.equal(second.brokerTicket.batch?.batchRate, 1);
  assert.equal(second.brokerTicket.batch?.buildsPerWave, 1);
}

function testRunnerSyncRejectsCrossWaveMissingWaveAndSurfaceMismatchBatching() {
  let queue = emptyRunnerSyncStewardQueue(t0);
  queue = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-A',
    actorId: 'agent-a',
    sealedSourceSha: 'sha-wave',
    requestedSurfaces: ['release/atm-onefile/atm.mjs'],
    waveId: 'wave-1',
    surfaceFamily: 'release',
    createdAt: t0,
    heartbeatAt: t0
  }).queue;
  const crossWave = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-C',
    actorId: 'agent-c',
    sealedSourceSha: 'sha-wave',
    requestedSurfaces: ['release/atm-root-drop'],
    waveId: 'wave-2',
    surfaceFamily: 'release',
    createdAt: '2026-07-18T00:00:02.000Z',
    heartbeatAt: '2026-07-18T00:00:02.000Z'
  });
  const missingWave = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-D',
    actorId: 'agent-d',
    sealedSourceSha: 'sha-wave',
    requestedSurfaces: ['release/atm-root-drop'],
    surfaceFamily: 'release',
    createdAt: '2026-07-18T00:00:03.000Z',
    heartbeatAt: '2026-07-18T00:00:03.000Z'
  });
  const surfaceMismatch = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-E',
    actorId: 'agent-e',
    sealedSourceSha: 'sha-wave',
    requestedSurfaces: ['packages/core/src/broker/x.ts'],
    waveId: 'wave-1',
    surfaceFamily: 'core',
    createdAt: '2026-07-18T00:00:04.000Z',
    heartbeatAt: '2026-07-18T00:00:04.000Z'
  });

  assert.equal(crossWave.brokerTicket.batchEligible, false);
  assert.equal(missingWave.brokerTicket.batchEligible, false);
  assert.equal(surfaceMismatch.brokerTicket.batchEligible, false);
}

function testProjectionSameWaveBatchEvidence() {
  let steward = emptyGeneratedProjectionSteward(t0);
  steward = enqueueGeneratedProjectionRebuild(steward, {
    taskId: 'TASK-P1',
    actorId: 'agent-p1',
    projectionKey: 'atm.generated-projection.governance-backlog',
    sourceItemPaths: ['docs/governance/atm-bug-and-optimization-backlog.items/A.json'],
    waveId: 'wave-proj',
    surfaceFamily: 'projection:governance',
    validators: ['node validate-projection.js'],
    createdAt: t0,
    heartbeatAt: t0
  }).queue;
  const second = enqueueGeneratedProjectionRebuild(steward, {
    taskId: 'TASK-P2',
    actorId: 'agent-p2',
    projectionKey: 'atm.generated-projection.governance-backlog',
    sourceItemPaths: ['docs/governance/atm-bug-and-optimization-backlog.items/B.json'],
    waveId: 'wave-proj',
    surfaceFamily: 'projection:governance',
    createdAt: '2026-07-18T00:00:01.000Z',
    heartbeatAt: '2026-07-18T00:00:01.000Z'
  });

  assert.equal(second.brokerTicket.batchEligible, true);
  assert.deepEqual(second.brokerTicket.batch?.taskIds, ['TASK-P1', 'TASK-P2']);
  assert.equal(second.brokerTicket.batch?.sharedSurfaceFamily, 'projection:governance');
}

function testBranchCommitBatchEvidence() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-commit-batch-'));
  execFileSync('git', ['init', '-b', 'main'], { cwd: repo, stdio: 'ignore' });
  const lockDir = path.join(repo, '.atm', 'runtime', 'locks', 'git-commit-queue-refs-heads-main.lock');
  mkdirSync(lockDir, { recursive: true });
  writeFileSync(path.join(lockDir, 'record.json'), JSON.stringify({
    actorId: 'agent-head',
    taskId: 'TASK-C1',
    waveId: 'wave-commit',
    surfaceFamily: 'branch-commit:main',
    validators: ['npm run typecheck'],
    acquiredAt: t0
  }, null, 2));

  const busy = evaluateTaskflowBranchCommitQueueGate({
    cwd: repo,
    taskId: 'TASK-C2',
    actorId: 'agent-waiter',
    waveId: 'wave-commit',
    surfaceFamily: 'branch-commit:main',
    validators: ['npm run validate:cli']
  });
  assert.equal(busy.status, 'busy');
  assert.equal(busy.brokerTicket?.batchEligible, true);
  assert.deepEqual(busy.brokerTicket?.batch?.taskIds, ['TASK-C1', 'TASK-C2']);
  assert.deepEqual(busy.brokerTicket?.batch?.validators, ['npm run typecheck', 'npm run validate:cli']);

  const evidence = buildTaskflowCommitBatchEvidence({
    waveId: 'wave-commit',
    surfaceFamily: 'branch-commit:main',
    branchName: 'main',
    taskIds: ['TASK-C2', 'TASK-C1'],
    validators: ['npm run typecheck']
  });
  assert.equal(evidence?.batchRate, 1);
  assert.equal(evidence?.buildsPerWave, 1);
}

testRunnerSyncSameWaveBatches();
testRunnerSyncRejectsCrossWaveMissingWaveAndSurfaceMismatchBatching();
testProjectionSameWaveBatchEvidence();
testBranchCommitBatchEvidence();

console.log('[related-task-batching-wave-surface.test] ok');

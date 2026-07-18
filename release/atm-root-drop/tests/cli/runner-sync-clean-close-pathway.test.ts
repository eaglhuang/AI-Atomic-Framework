import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRunnerSyncReceipt, writeRunnerSyncReceipt, type SealedBuildTimings } from '../../scripts/run-sealed-runner-build.ts';
import { validateRunnerSyncReleaseReceipt } from '../../packages/cli/src/commands/broker/steward-queues.ts';
import type { RunnerSyncStewardQueueDocument } from '../../packages/core/src/broker/runner-sync-steward-queue.ts';
import type { RunnerSyncAdmissionReport } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-clean-close-'));
const queue = makeQueue();
const admission = makeAdmission();
const timings: SealedBuildTimings = {
  startedAt: Date.now(),
  inputHashCalculationMs: 1,
  skipDecisionMs: 2,
  worktreeSetupMs: 3,
  typescriptBuildMs: 4,
  rootDropAssemblyMs: 5,
  onefileAssemblyMs: 6,
  artifactSyncMs: 7,
  cleanupMs: 8,
  totalElapsedMs: 36
};

try {
  const receipt = buildRunnerSyncReceipt({
    admission,
    actorId: 'captain-a',
    sealedSourceSha: 'sha256:source-a',
    buildTarget: 'full',
    buildInputsTreeHash: 'sha256:inputs',
    buildDecision: 'cache-hit-skip',
    timings,
    publishedAt: '2026-07-18T00:00:00.000Z'
  });
  assert.equal(receipt.schemaId, 'atm.runnerSyncReceipt.v1');
  assert.equal(receipt.taskId, 'TASK-A');
  assert.equal(receipt.stewardWorkId, 'runner-sync-fixture');
  assert.deepEqual(receipt.requestedSurfaces, [
    'release/atm-onefile/atm.mjs',
    'release/atm-root-drop/atm.mjs'
  ]);

  const receiptRef = writeRunnerSyncReceipt({
    cwd: repo,
    admission,
    actorId: 'captain-a',
    sealedSourceSha: 'sha256:source-a',
    buildTarget: 'full',
    buildInputsTreeHash: 'sha256:inputs',
    buildDecision: 'cache-hit-skip',
    timings
  });
  assert.equal(receiptRef, '.atm/history/evidence/TASK-A.runner-sync-receipt.json');
  const raw = readFileSync(path.join(repo, receiptRef), 'utf8');
  const digest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;

  const valid = validateRunnerSyncReleaseReceipt({
    cwd: repo,
    queue,
    taskId: 'TASK-A',
    stewardWorkId: 'runner-sync-fixture',
    receiptRef,
    receiptDigest: digest
  });
  assert.equal(valid.receiptRef, receiptRef);
  assert.equal(valid.receiptDigest, digest);

  assert.throws(() => validateRunnerSyncReleaseReceipt({
    cwd: repo,
    queue,
    taskId: 'TASK-A',
    stewardWorkId: 'runner-sync-fixture',
    receiptRef,
    receiptDigest: 'sha256:not-the-digest'
  }), /ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_DIGEST_MISMATCH/);

  const badReceiptRef = '.atm/history/evidence/TASK-A.bad-runner-sync-receipt.json';
  mkdirSync(path.dirname(path.join(repo, badReceiptRef)), { recursive: true });
  writeFileSync(path.join(repo, badReceiptRef), `${JSON.stringify({
    ...JSON.parse(raw),
    sealedSourceSha: 'sha256:wrong'
  }, null, 2)}\n`, 'utf8');
  assert.throws(() => validateRunnerSyncReleaseReceipt({
    cwd: repo,
    queue,
    taskId: 'TASK-A',
    stewardWorkId: 'runner-sync-fixture',
    receiptRef: badReceiptRef,
    receiptDigest: null
  }), /ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_INVALID/);

  console.log('[runner-sync-clean-close-pathway.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

function makeAdmission(): RunnerSyncAdmissionReport {
  return {
    schemaId: 'atm.runnerSyncAdmission.v1',
    ok: true,
    stewardActorId: 'captain-a',
    sealedSourceSha: 'sha256:source-a',
    runnerSyncSteward: {
      stewardWorkId: 'runner-sync-fixture',
      queuePosition: 1,
      suggestedNextAction: 'release with receipt',
      waitingTasks: ['TASK-A', 'TASK-B'],
      requestedSurfaces: [
        'release/atm-onefile/atm.mjs',
        'release/atm-root-drop/atm.mjs'
      ],
      requests: [
        {
          taskId: 'TASK-A',
          actorId: 'captain-a',
          requestedSurfaces: ['release/atm-onefile/atm.mjs']
        },
        {
          taskId: 'TASK-B',
          actorId: 'captain-b',
          requestedSurfaces: ['release/atm-root-drop/atm.mjs']
        }
      ]
    },
    queueHeadOwnership: {
      ok: true,
      stewardWorkId: 'runner-sync-fixture',
      queuePosition: 1,
      queueHeadHealth: 'task-active',
      waitingTasks: ['TASK-A', 'TASK-B'],
      ownerActorIds: ['captain-a', 'captain-b'],
      reason: null,
      cleanupCommand: null
    },
    foreignNonReleaseWip: [],
    foreignBuildInputConflicts: [],
    releaseWip: [],
    ordinaryTaskReleaseAutoStageAllowed: false,
    brokerTicket: null,
    requiredCommand: null
  };
}

function makeQueue(): RunnerSyncStewardQueueDocument {
  return {
    schemaId: 'atm.runnerSyncStewardQueue.v1',
    specVersion: '0.1.0',
    stewardKey: 'atm.runner-sync.coalescing-steward',
    updatedAt: '2026-07-18T00:00:00.000Z',
    groups: [{
      stewardWorkId: 'runner-sync-fixture',
      sealedSourceSha: 'sha256:source-a',
      waveId: null,
      surfaceFamily: 'runner-sync',
      queuePosition: 1,
      status: 'queue-head',
      queueHeadHealth: 'task-active',
      createdAt: '2026-07-18T00:00:00.000Z',
      updatedAt: '2026-07-18T00:00:00.000Z',
      requestedSurfaces: [
        'release/atm-onefile/atm.mjs',
        'release/atm-root-drop/atm.mjs'
      ],
      waitingTasks: ['TASK-A', 'TASK-B'],
      suggestedNextAction: 'release with receipt',
      requests: [
        {
          taskId: 'TASK-A',
          actorId: 'captain-a',
          sealedSourceSha: 'sha256:source-a',
          requestedSurfaces: ['release/atm-onefile/atm.mjs'],
          waveId: null,
          surfaceFamily: 'runner-sync',
          validators: [],
          createdAt: '2026-07-18T00:00:00.000Z',
          heartbeatAt: '2026-07-18T00:00:00.000Z',
          expiresAt: '2026-07-18T00:07:00.000Z',
          ttlSeconds: 420,
          queuePosition: 1,
          suggestedNextAction: 'release with receipt'
        },
        {
          taskId: 'TASK-B',
          actorId: 'captain-b',
          sealedSourceSha: 'sha256:source-a',
          requestedSurfaces: ['release/atm-root-drop/atm.mjs'],
          waveId: null,
          surfaceFamily: 'runner-sync',
          validators: [],
          createdAt: '2026-07-18T00:00:01.000Z',
          heartbeatAt: '2026-07-18T00:00:01.000Z',
          expiresAt: '2026-07-18T00:07:01.000Z',
          ttlSeconds: 420,
          queuePosition: 1,
          suggestedNextAction: 'release with receipt'
        }
      ]
    }]
  };
}

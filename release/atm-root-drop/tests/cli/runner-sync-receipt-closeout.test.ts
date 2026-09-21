import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateRunnerSyncReleaseReceipt } from '../../packages/cli/src/commands/broker/steward-queues.ts';
import { buildRunnerSyncReceipt } from '../../scripts/runner-sync-incremental-build.ts';
import type { SealedBuildTimings } from '../../scripts/run-sealed-runner-build.ts';
import type { RunnerSyncAdmissionReport } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import { enqueueRunnerSyncStewardRequest } from '../../packages/core/src/broker/runner-sync-steward-queue.ts';

// test_runner_sync_receipt_closeout_91c0d4a2
// A terminal receipt must bind the queue member, steward work, and durable
// evidence path; invalid or duplicate closeout remains fail-closed.
const root = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-closeout-'));
const seal = 'a'.repeat(40);
const inputHash = `sha256:${'b'.repeat(64)}`;
const timings: SealedBuildTimings = {
  startedAt: 1, inputHashCalculationMs: 1, skipDecisionMs: 1, worktreeSetupMs: 1,
  typescriptBuildMs: 1, rootDropAssemblyMs: 1, onefileAssemblyMs: 1,
  artifactSyncMs: 1, cleanupMs: 1, totalElapsedMs: 8
};
const admission = {
  schemaId: 'atm.runnerSyncAdmission.v1', ok: true, stewardActorId: 'steward',
  sealedSourceSha: seal,
  actorAuthority: { ok: true, actorId: 'steward', resolutionSource: 'option', legacyEnvActorId: null, legacyEnvDisagrees: false, laneSessionId: null, queueHeadOwnerActorIds: [], activeClaimOwnerActorId: null, recoveryCommand: null, reason: null },
  runnerSyncSteward: { stewardWorkId: 'runner-sync-closeout', queuePosition: 1, suggestedNextAction: 'release', requestedSurfaces: ['release/atm-root-drop'], waitingTasks: ['TASK-RUNNER-CLOSE'], requests: [{ taskId: 'TASK-RUNNER-CLOSE', actorId: 'steward', requestedSurfaces: ['release/atm-root-drop'] }] },
  queueHeadOwnership: { ok: true, stewardWorkId: 'runner-sync-closeout', queuePosition: 1, queueHeadHealth: 'task-active', waitingTasks: ['TASK-RUNNER-CLOSE'], ownerActorIds: ['steward'], reason: null, cleanupCommand: null },
  foreignNonReleaseWip: [], foreignBuildInputConflicts: [], releaseWip: [], ordinaryTaskReleaseAutoStageAllowed: false, brokerTicket: null, requiredCommand: null, orderedCommandManifests: []
} as unknown as RunnerSyncAdmissionReport;

function writeReceipt(value: unknown): string {
  const ref = '.atm/history/evidence/TASK-RUNNER-CLOSE.runner-sync-receipt.json';
  const absolute = path.join(root, ref);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return ref;
}

try {
  const queue = enqueueRunnerSyncStewardRequest(null, {
    taskId: 'TASK-RUNNER-CLOSE', actorId: 'steward', sealedSourceSha: seal,
    requestedSurfaces: ['release/atm-root-drop'], createdAt: '2026-09-05T10:00:00.000Z',
    heartbeatAt: '2026-09-05T10:00:00.000Z'
  }).queue;
  const stewardWorkId = queue.groups[0]!.stewardWorkId;
  (admission.runnerSyncSteward as any).stewardWorkId = stewardWorkId;
  (admission.queueHeadOwnership as any).stewardWorkId = stewardWorkId;
  const receipt = buildRunnerSyncReceipt({
    admission, actorId: 'steward', actorIdentitySource: 'explicit',
    sealedSourceSha: seal, linkedTaskIds: ['TASK-RUNNER-CLOSE'], buildTarget: 'full',
    buildInputsTreeHash: inputHash, buildDecision: 'built', decisionReason: 'closeout fixture',
    incrementalPlan: null, runtimeTelemetryRef: null, tsBuildCache: null, timings,
    publishedAt: '2026-09-05T10:01:00.000Z'
  });
  const ref = writeReceipt(receipt);
  const validated = validateRunnerSyncReleaseReceipt({ cwd: root, queue, taskId: 'TASK-RUNNER-CLOSE', stewardWorkId, receiptRef: ref, receiptDigest: null });
  assert.equal(validated.receiptRef, ref);
  assert.match(validated.receiptDigest, /^sha256:[a-f0-9]{64}$/);

  assert.throws(() => validateRunnerSyncReleaseReceipt({
    cwd: root, queue, taskId: 'TASK-RUNNER-CLOSE', stewardWorkId: 'wrong-steward', receiptRef: ref, receiptDigest: null
  }), /ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_INVALID|ATM_RUNNER_SYNC/);
  assert.throws(() => validateRunnerSyncReleaseReceipt({
    cwd: root, queue: { ...queue, groups: [] }, taskId: 'TASK-RUNNER-CLOSE', stewardWorkId, receiptRef: ref, receiptDigest: null
  }), /ATM_RUNNER_SYNC_RESUME_REQUIRED/);
  console.log('[runner-sync-receipt-closeout.test] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}

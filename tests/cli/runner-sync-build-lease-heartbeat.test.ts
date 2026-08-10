import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  enqueueRunnerSyncStewardRequest,
  releaseRunnerSyncStewardQueue
} from '../../packages/core/src/broker/runner-sync-steward-queue.ts';
import {
  startRunnerSyncSession,
  renewRunnerSyncSession,
  recordRunnerSyncBuild,
  finalizeRunnerSyncPublication,
  verifyMemberAttribution,
  RUNNER_SYNC_SESSION_STATE_SCHEMA,
  type SessionPorts,
  type RunnerSyncMemberRequest,
  type BuildResult
} from '../../packages/core/src/broker/runner-sync-session.ts';
import {
  computeAggregateInputTreeHash,
  RUNNER_INPUT_GRAPH_SCHEMA,
  type RunnerInputGraph,
  type RunnerInputGraphNode
} from '../../packages/core/src/broker/runner-version-contract.ts';
import { validateRunnerSyncReleaseReceipt } from '../../packages/cli/src/commands/broker/steward-queues.ts';
import { buildRunnerSyncReceipt } from '../../scripts/runner-sync-incremental-build.ts';
import { shouldAutoReleaseRunnerSyncSteward } from '../../scripts/run-sealed-runner-build.ts';

// Deterministic clock helper.
function fixedPorts(iso: string): SessionPorts {
  return { now: () => iso };
}

const STEWARD = 'runner-sync-2e2e1430';
const SEAL = 'd'.repeat(40);
const INPUT_DIGEST = 'sha256:sealedin';
const members: readonly RunnerSyncMemberRequest[] = [
  { taskId: 'ATM-GOV-0240', actorId: 'captain', laneSessionId: 'lane-1', requestedSurfaces: ['release/atm-onefile/atm.mjs'] },
  { taskId: 'ATM-GOV-0248', actorId: 'captain', laneSessionId: 'lane-1', requestedSurfaces: ['release/atm-root-drop'] },
  { taskId: 'TASK-SKL-0029', actorId: 'captain', laneSessionId: 'lane-1', requestedSurfaces: ['packages/cli/dist'] }
];

const graphNodes: readonly RunnerInputGraphNode[] = [
  { segment: 'packages', inputPaths: ['packages/core/src/x.ts'], inputDigest: 'sha256:in', outputEntries: ['packages/core'], outputDigest: 'sha256:out' }
];
const buildResult: BuildResult = {
  sharedOutputDigest: 'sha256:sharedout',
  inputGraph: {
    schemaId: RUNNER_INPUT_GRAPH_SCHEMA,
    sealedSourceSha: SEAL,
    nodes: graphNodes,
    aggregateInputTreeHash: computeAggregateInputTreeHash(graphNodes)
  } as RunnerInputGraph
};

assert.equal(shouldAutoReleaseRunnerSyncSteward({}), false);
assert.equal(shouldAutoReleaseRunnerSyncSteward({ ATM_RUNNER_SYNC_AUTO_RELEASE: '0' }), false);
assert.equal(shouldAutoReleaseRunnerSyncSteward({ ATM_RUNNER_SYNC_AUTO_RELEASE: '1' }), true);

// 1. Start binds all three coalesced members into the manifest (memberTaskIds).
const started = startRunnerSyncSession(
  { stewardWorkId: STEWARD, sealedSourceSha: SEAL, members, sharedSealedInputDigest: INPUT_DIGEST, buildLeaseTtlSeconds: 3600 },
  fixedPorts('2026-07-27T08:00:00.000Z')
);
assert.equal(started.allowed, true);
assert.equal(started.state.schemaId, RUNNER_SYNC_SESSION_STATE_SCHEMA);
assert.equal(started.state.phase, 'prepared');
assert.deepEqual([...started.state.groupManifest.memberTaskIds], ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);
assert.equal(started.state.buildLease, null);

// 2. Lease renewal within TTL extends the lease.
const renewed = renewRunnerSyncSession(started.state, fixedPorts('2026-07-27T08:30:00.000Z'));
assert.equal(renewed.allowed, true);
assert.equal(renewed.action, 'wait');
assert.equal(renewed.state.buildLease, null);

// 3. Lease expired → ATM_RUNNER_SYNC_STEWARD_LEASE_EXPIRED with resume path, no drop.
const expired = renewRunnerSyncSession(started.state, fixedPorts('2026-07-27T10:00:00.000Z'));
assert.equal(expired.allowed, true);
assert.equal(expired.errorCode, null);
assert.equal(expired.action, 'wait');
assert.equal(expired.state.buildLease, null);
// The manifest (member attribution) survives an expired lease.
assert.deepEqual([...expired.state.groupManifest.memberTaskIds], ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);

// 4. Record build publishes exactly one attributable child receipt per member.
const recorded = recordRunnerSyncBuild(started.state, buildResult, fixedPorts('2026-07-27T08:45:00.000Z'));
assert.equal(recorded.allowed, true);
assert.equal(recorded.state.phase, 'built-provisional');
assert.equal(recorded.childReceipts.length, 3);
assert.deepEqual(recorded.childReceipts.map((r) => r.taskId).sort(), ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);
for (const receipt of recorded.childReceipts) {
  assert.equal(receipt.parentStewardWorkId, STEWARD);
  assert.equal(receipt.groupManifestDigest, recorded.state.groupManifest.manifestDigest);
  assert.equal(receipt.sharedOutputDigest, buildResult.sharedOutputDigest);
}
assert.equal(verifyMemberAttribution(recorded.state).complete, true);

// 5. Finalize with full attribution + continuous seal → release.
const finalized = finalizeRunnerSyncPublication(
  recorded.state,
  { currentHead: SEAL, headDeltaPaths: [] },
  fixedPorts('2026-07-27T08:46:00.000Z')
);
assert.equal(finalized.allowed, true);
assert.equal(finalized.action, 'release');
assert.equal(finalized.state.phase, 'published');
// Group state (member attribution) survives publication.
assert.deepEqual([...finalized.state.groupManifest.memberTaskIds], ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);
assert.equal(finalized.childReceipts.length, 3);

// 6. Production receipt wiring: one coalesced group receipt carries every
//    member id, child attribution, runner-input digest, and finalizable lifecycle.
{
  let queue = enqueueRunnerSyncStewardRequest(null, {
    taskId: 'ATM-GOV-0240',
    actorId: 'captain',
    sealedSourceSha: SEAL,
    requestedSurfaces: ['release/atm-onefile/atm.mjs'],
    createdAt: '2026-07-27T08:00:00.000Z',
    heartbeatAt: '2026-07-27T08:00:00.000Z'
  }).queue;
  queue = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'ATM-GOV-0248',
    actorId: 'captain',
    sealedSourceSha: SEAL,
    requestedSurfaces: ['release/atm-root-drop'],
    createdAt: '2026-07-27T08:00:01.000Z',
    heartbeatAt: '2026-07-27T08:00:01.000Z'
  }).queue;
  const queued = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-SKL-0029',
    actorId: 'captain',
    sealedSourceSha: SEAL,
    requestedSurfaces: ['packages/cli/dist'],
    createdAt: '2026-07-27T08:00:02.000Z',
    heartbeatAt: '2026-07-27T08:00:02.000Z'
  });
  const group = queued.queue.groups[0]!;
  const admission = {
    schemaId: 'atm.runnerSyncAdmission.v1',
    ok: true,
    stewardActorId: 'captain',
    sealedSourceSha: SEAL,
    actorAuthority: { ok: true },
    runnerSyncSteward: {
      stewardWorkId: group.stewardWorkId,
      queuePosition: 1,
      suggestedNextAction: group.suggestedNextAction,
      requestedSurfaces: group.requestedSurfaces,
      waitingTasks: group.waitingTasks,
      requests: group.requests.map((request) => ({
        taskId: request.taskId,
        actorId: request.actorId,
        requestedSurfaces: request.requestedSurfaces
      }))
    },
    queueHeadOwnership: {
      ok: true,
      stewardWorkId: group.stewardWorkId,
      queuePosition: 1,
      queueHeadHealth: 'task-active',
      waitingTasks: group.waitingTasks,
      ownerActorIds: ['captain'],
      reason: null,
      cleanupCommand: null
    },
    foreignNonReleaseWip: [],
    foreignBuildInputConflicts: [],
    releaseWip: [],
    ordinaryTaskReleaseAutoStageAllowed: false,
    brokerTicket: null,
    requiredCommand: null
  } as any;
  const receipt = buildRunnerSyncReceipt({
    admission,
    actorId: 'captain',
    sealedSourceSha: SEAL,
    buildTarget: 'full',
    buildInputsTreeHash: INPUT_DIGEST,
    buildDecision: 'built',
    decisionReason: 'fixture',
    timings: {
      startedAt: 0,
      inputHashCalculationMs: 1,
      skipDecisionMs: 1,
      worktreeSetupMs: 1,
      typescriptBuildMs: 1,
      rootDropAssemblyMs: 1,
      onefileAssemblyMs: 1,
      artifactSyncMs: 1,
      cleanupMs: 1,
      totalElapsedMs: 8
    },
    publishedAt: '2026-07-27T08:01:00.000Z'
  });
  assert.deepEqual([...receipt.memberTaskIds], ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);
  assert.equal(receipt.childReceipts.length, 3);
  assert.equal(receipt.childAttribution.complete, true);
  assert.equal(receipt.lifecycle.provisionalState, 'built-provisional');
  assert.equal(receipt.lifecycle.publicationReadyState, 'publication-ready');
  assert.equal(receipt.lifecycle.reconcilePhase, 'reconciled');
  assert.equal(receipt.lifecycle.finalizable, true);
  assert.equal(receipt.runnerInputTreeHash, INPUT_DIGEST);

  const receiptRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-receipt-'));
  const receiptRef = writeTempReceipt(receiptRepo, receipt);
  const validated = validateRunnerSyncReleaseReceipt({
    cwd: receiptRepo,
    queue: queued.queue,
    taskId: 'ATM-GOV-0240',
    stewardWorkId: group.stewardWorkId,
    receiptRef,
    receiptDigest: null
  });
  assert.equal(queued.queue.groups.length, 1, 'release receipt validation must not clear the queue');
  const released = releaseRunnerSyncStewardQueue(queued.queue, {
    taskId: 'ATM-GOV-0240',
    stewardWorkId: group.stewardWorkId,
    receiptRef: validated.receiptRef,
    receiptDigest: validated.receiptDigest,
    releasedAt: '2026-07-27T08:02:00.000Z'
  });
  assert.equal(released.queue.groups.length, 0, 'explicit runner-sync release removes the queue group after validation');
  assert.throws(() => validateRunnerSyncReleaseReceipt({
    cwd: receiptRepo,
    queue: released.queue,
    taskId: 'ATM-GOV-0240',
    stewardWorkId: group.stewardWorkId,
    receiptRef,
    receiptDigest: null
  }), /ATM_RUNNER_SYNC_RESUME_REQUIRED/, 'duplicate release must fail closed when the group is gone');

  const invalidReceipt = { ...receipt, lifecycle: { ...receipt.lifecycle, finalizable: false } };
  assert.throws(() => validateRunnerSyncReleaseReceipt({
    cwd: receiptRepo,
    queue: queued.queue,
    taskId: 'ATM-GOV-0240',
    stewardWorkId: group.stewardWorkId,
    receiptRef: writeTempReceipt(receiptRepo, invalidReceipt),
    receiptDigest: null
  }), /ATM_RUNNER_SYNC_COALESCED_ATTRIBUTION_MISSING/);
  assert.equal(queued.queue.groups.length, 1, 'release validation failure must not clear the queue fixture');

  assert.throws(() => validateRunnerSyncReleaseReceipt({
    cwd: receiptRepo,
    queue: { ...queued.queue, groups: [] },
    taskId: 'ATM-GOV-0240',
    stewardWorkId: group.stewardWorkId,
    receiptRef: writeTempReceipt(receiptRepo, receipt),
    receiptDigest: null
  }), /ATM_RUNNER_SYNC_RESUME_REQUIRED/);
}

function writeTempReceipt(cwd: string, value: unknown): string {
  const rel = `.atm/runtime/test-receipts/${Date.now()}-${Math.random().toString(16).slice(2)}.json`;
  const absolute = path.join(cwd, rel);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return rel;
}

console.log('runner-sync-build-lease-heartbeat.test.ts: assertions passed');

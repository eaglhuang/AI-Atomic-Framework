import assert from 'node:assert/strict';
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
  RUNNER_SYNC_ERROR_CODES,
  RUNNER_INPUT_GRAPH_SCHEMA,
  type RunnerInputGraph,
  type RunnerInputGraphNode
} from '../../packages/core/src/broker/runner-version-contract.ts';

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

// 1. Start binds all three coalesced members into the manifest (memberTaskIds).
const started = startRunnerSyncSession(
  { stewardWorkId: STEWARD, sealedSourceSha: SEAL, members, sharedSealedInputDigest: INPUT_DIGEST, buildLeaseTtlSeconds: 3600 },
  fixedPorts('2026-07-27T08:00:00.000Z')
);
assert.equal(started.allowed, true);
assert.equal(started.state.schemaId, RUNNER_SYNC_SESSION_STATE_SCHEMA);
assert.equal(started.state.phase, 'building');
assert.deepEqual([...started.state.groupManifest.memberTaskIds], ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);
assert.ok(started.state.buildLease);

// 2. Lease renewal within TTL extends the lease.
const renewed = renewRunnerSyncSession(started.state, fixedPorts('2026-07-27T08:30:00.000Z'));
assert.equal(renewed.allowed, true);
assert.equal(renewed.action, 'renew-lease');
assert.ok(renewed.state.buildLease && renewed.state.buildLease.expiresAt > started.state.buildLease!.expiresAt);

// 3. Lease expired → ATM_RUNNER_SYNC_STEWARD_LEASE_EXPIRED with resume path, no drop.
const expired = renewRunnerSyncSession(started.state, fixedPorts('2026-07-27T10:00:00.000Z'));
assert.equal(expired.allowed, false);
assert.equal(expired.errorCode, RUNNER_SYNC_ERROR_CODES.stewardLeaseExpired);
assert.equal(expired.action, 'resume-build');
assert.ok(expired.recoveryCommand && expired.recoveryCommand.includes('resume'));
// The manifest (member attribution) survives an expired lease.
assert.deepEqual([...expired.state.groupManifest.memberTaskIds], ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);

// 4. Record build publishes exactly one attributable child receipt per member.
const recorded = recordRunnerSyncBuild(started.state, buildResult, fixedPorts('2026-07-27T08:45:00.000Z'));
assert.equal(recorded.allowed, true);
assert.equal(recorded.state.phase, 'receipt-published');
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
assert.equal(finalized.state.phase, 'released');

console.log('runner-sync-build-lease-heartbeat.test.ts: assertions passed');

import assert from 'node:assert/strict';
import {
  startRunnerSyncSession,
  recordRunnerSyncBuild,
  attestRunnerSyncPublication,
  finalizeRunnerSyncPublication,
  reconcileRunnerSyncSession,
  type SessionPorts,
  type RunnerSyncMemberRequest,
  type BuildResult,
  type RunnerSyncSessionState
} from '../../packages/core/src/broker/runner-sync-session.ts';
import {
  computeAggregateInputTreeHash,
  RUNNER_SYNC_ERROR_CODES,
  RUNNER_INPUT_GRAPH_SCHEMA,
  type RunnerInputGraphNode
} from '../../packages/core/src/broker/runner-version-contract.ts';

function fixedPorts(iso: string): SessionPorts {
  return { now: () => iso };
}

const STEWARD = 'runner-sync-2e2e1430';
const SEAL = 'e'.repeat(40);
const members: readonly RunnerSyncMemberRequest[] = [
  { taskId: 'ATM-GOV-0240', actorId: 'captain', laneSessionId: 'lane-1', requestedSurfaces: ['release/atm-onefile/atm.mjs'] },
  { taskId: 'ATM-GOV-0248', actorId: 'captain', laneSessionId: 'lane-1', requestedSurfaces: ['release/atm-root-drop'] },
  { taskId: 'TASK-SKL-0029', actorId: 'captain', laneSessionId: 'lane-1', requestedSurfaces: ['packages/cli/dist'] }
];
const gnodes: readonly RunnerInputGraphNode[] = [
  { segment: 'packages', inputPaths: ['packages/core/src/x.ts'], inputDigest: 'sha256:in', outputEntries: ['packages/core'], outputDigest: 'sha256:out' }
];
const buildResult: BuildResult = {
  sharedOutputDigest: 'sha256:sharedout',
  inputGraph: { schemaId: RUNNER_INPUT_GRAPH_SCHEMA, sealedSourceSha: SEAL, nodes: gnodes, aggregateInputTreeHash: computeAggregateInputTreeHash(gnodes) }
};

const started = startRunnerSyncSession(
  { stewardWorkId: STEWARD, sealedSourceSha: SEAL, members, sharedSealedInputDigest: 'sha256:sealedin', buildLeaseTtlSeconds: 1800 },
  fixedPorts('2026-07-27T08:00:00.000Z')
);

// 1. Crash while building: reconcile after lease expiry → deterministic resume.
{
  const resume = reconcileRunnerSyncSession(
    started.state,
    { currentHead: SEAL, headDeltaPaths: [] },
    fixedPorts('2026-07-27T09:30:00.000Z') // > 1800s past start
  );
  assert.equal(resume.allowed, true);
  assert.equal(resume.errorCode, null);
  assert.equal(resume.action, 'build');
  // Member attribution preserved across the crash.
  assert.deepEqual([...resume.state.groupManifest.memberTaskIds], ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);
}

// 2. Reconcile while lease still live → wait (build in progress), no drop.
{
  const live = reconcileRunnerSyncSession(
    started.state,
    { currentHead: SEAL, headDeltaPaths: [] },
    fixedPorts('2026-07-27T08:10:00.000Z')
  );
  assert.equal(live.action, 'build');
  assert.equal(live.allowed, true);
}

// 3. REGRESSION (the ATM-GOV-0240 defect): a head-owner-only receipt state must
//    fail closed on finalize with coalesced-attribution-missing.
{
  const recorded = recordRunnerSyncBuild(started.state, buildResult, fixedPorts('2026-07-27T08:20:00.000Z'));
  // Simulate the old single-task receipt: keep only the head owner's child receipt.
  const headOnly: RunnerSyncSessionState = {
    ...recorded.state,
    childReceipts: recorded.childReceipts.filter((r) => r.taskId === 'ATM-GOV-0240')
  };
  const finalize = finalizeRunnerSyncPublication(headOnly, { currentHead: SEAL, headDeltaPaths: [] }, fixedPorts('2026-07-27T08:21:00.000Z'));
  assert.equal(finalize.allowed, false);
  assert.equal(finalize.errorCode, RUNNER_SYNC_ERROR_CODES.coalescedAttributionMissing);
  assert.equal(finalize.state.phase, 'built-provisional'); // provisional retained, not published
  assert.match(finalize.reason, /ATM-GOV-0248/);
  assert.match(finalize.reason, /TASK-SKL-0029/);
  // Group manifest survives the failed finalize.
  assert.deepEqual([...finalize.state.groupManifest.memberTaskIds], ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);
}

// 4. Full attribution + seal-revalidation on runner-affecting HEAD delta →
//    provisional build abandoned; reconcile of an abandoned session resumes to
//    rebuild without erasing group state.
{
  const recorded = recordRunnerSyncBuild(started.state, buildResult, fixedPorts('2026-07-27T08:20:00.000Z'));
  const finalize = finalizeRunnerSyncPublication(
    recorded.state,
    { currentHead: 'f'.repeat(40), headDeltaPaths: ['packages/core/src/broker/runner-sync-session.ts'] },
    fixedPorts('2026-07-27T08:22:00.000Z')
  );
  assert.equal(finalize.allowed, false);
  assert.equal(finalize.errorCode, RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired);
  assert.equal(finalize.action, 'revalidate-seal');
  assert.equal(finalize.state.phase, 'abandoned');
  assert.deepEqual([...finalize.state.groupManifest.memberTaskIds], ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);

  const resume = reconcileRunnerSyncSession(finalize.state, { currentHead: SEAL, headDeltaPaths: [] }, fixedPorts('2026-07-27T08:23:00.000Z'));
  assert.equal(resume.action, 'resume-build');
  assert.equal(resume.errorCode, RUNNER_SYNC_ERROR_CODES.resumeRequired);
  assert.deepEqual([...resume.state.groupManifest.memberTaskIds], ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);
}

// 5. Provisional → attest → publication-ready → published happy path.
{
  const recorded = recordRunnerSyncBuild(started.state, buildResult, fixedPorts('2026-07-27T08:20:00.000Z'));
  assert.equal(recorded.state.phase, 'built-provisional');
  const attested = attestRunnerSyncPublication(recorded.state, fixedPorts('2026-07-27T08:20:30.000Z'));
  assert.equal(attested.allowed, true);
  assert.equal(attested.state.phase, 'publication-ready');
  const released = finalizeRunnerSyncPublication(attested.state, { currentHead: SEAL, headDeltaPaths: [] }, fixedPorts('2026-07-27T08:23:00.000Z'));
  assert.equal(released.state.phase, 'published');
  const again = reconcileRunnerSyncSession(released.state, { currentHead: SEAL, headDeltaPaths: [] }, fixedPorts('2026-07-27T08:24:00.000Z'));
  assert.equal(again.action, 'complete');
  assert.equal(again.allowed, true);
}

// 6. Reconcile-driven recovery of a provisional session reaches `reconciled`.
{
  const recorded = recordRunnerSyncBuild(started.state, buildResult, fixedPorts('2026-07-27T08:20:00.000Z'));
  const reconciled = reconcileRunnerSyncSession(recorded.state, { currentHead: SEAL, headDeltaPaths: [] }, fixedPorts('2026-07-27T08:25:00.000Z'));
  assert.equal(reconciled.allowed, true);
  assert.equal(reconciled.state.phase, 'reconciled');
  assert.deepEqual([...reconciled.state.groupManifest.memberTaskIds], ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);
  assert.equal(reconciled.childReceipts.length, 3);
  assert.deepEqual(reconciled.childReceipts.map((receipt) => receipt.taskId).sort(), ['ATM-GOV-0240', 'ATM-GOV-0248', 'TASK-SKL-0029']);
}

console.log('runner-sync-steward-crash-resume.test.ts: assertions passed');

import assert from 'node:assert/strict';
import {
  buildReplayDashboardSnapshot,
  createReplayRunManifest,
  renderReplayDashboardHuman,
  type ReplayDashboardInput
} from '../../packages/core/src/broker/replay/dashboard.ts';

const validInput: ReplayDashboardInput = {
  runId: 'run-fixture',
  generatedAt: '2026-01-01T00:00:00.000Z',
  participants: [
    participant('captain-a', 'actor-a', 101),
    participant('captain-b', 'actor-b', 202)
  ],
  sharedPhysicalFile: 'docs/governance/atm-3-replay-evidence.md',
  logicalIntents: [
    { intentId: 'intent-a', physicalPath: 'docs/governance/atm-3-replay-evidence.md', digest: 'sha256:intent-a', privateOutputDigest: 'sha256:private-a', proposalRoot: '.atm/runtime/proposals/a' },
    { intentId: 'intent-b', physicalPath: 'docs/governance/atm-3-replay-evidence.md', digest: 'sha256:intent-b', privateOutputDigest: 'sha256:private-b', proposalRoot: '.atm/runtime/proposals/b' }
  ],
  validatorSeal: {
    policyDigest: 'sha256:policy',
    unionDigest: 'sha256:union',
    selectionInputDigest: 'sha256:selection',
    negativeControlRevealedAt: '2026-01-01T00:00:01.000Z',
    currentUnionDigest: 'sha256:union'
  },
  thresholds: { minimumParticipants: 2, minimumOverlapRatio: 0.3 },
  timeWindow: { startedAt: '2026-01-01T00:00:00.000Z', endedAt: '2026-01-01T00:01:00.000Z' },
  stopRule: 'fail closed on any closure-critical predicate',
  admissionFacadeDisposition: 'required',
  adapterDecision: 'canonical-evidence-only',
  candidateOutputDigests: ['sha256:private-a', 'sha256:private-b'],
  validatorRunDigests: ['sha256:validator-run'],
  commands: ['node atm.mjs broker replay dashboard --json'],
  usageErrors: [],
  continuations: ['continue-after-timeout'],
  terminalPrunes: [],
  manualInterventions: [],
  falseStops: [],
  unavailableReceipts: [],
  cleanupRequired: false,
  manualRecoveryRequired: false,
  safeCompose: true,
  staleFallbackUsed: false,
  trueConflict: false,
  publication: { status: 'source-available', sourceAvailable: true, costRatio: 1, throughputGainRatio: 1 },
  receipts: { taskLane0022: 'sha256:lane', atmGov0265: 'sha256:reservation' },
  admissionTrace: ['identity', 'scope', 'ticket', 'queue', 'compose', 'validator', 'close'],
  producerVerdictLabel: 'not authoritative'
};

const ready = buildReplayDashboardSnapshot(validInput);
assert.equal(ready.readiness, 'ready');
assert.equal(ready.blockers.length, 0);
assert.match(renderReplayDashboardHuman(ready), /Replay dashboard: ready/);
assert.equal(ready.digest, buildReplayDashboardSnapshot({ ...validInput, producerVerdictLabel: 'producer-says-failed' }).digest);

const manifest = createReplayRunManifest(validInput);
assert.equal(manifest.digest, ready.manifest.digest);
assert.equal(manifest.validatorSeal.unionDigest, 'sha256:union');

const producerLabelCannotOverrideCanonicalEvidence = buildReplayDashboardSnapshot({
  ...validInput,
  participants: [
    { ...participant('captain-a', 'same-actor', 101), producerLabel: 'ready' },
    { ...participant('captain-b', 'same-actor', 101), producerLabel: 'ready' }
  ],
  producerVerdictLabel: 'ready'
});
assert.equal(producerLabelCannotOverrideCanonicalEvidence.readiness, 'not-ready');
assert.ok(producerLabelCannotOverrideCanonicalEvidence.blockers.some((entry) => entry.includes('participants.distinct-actors')));
assert.ok(producerLabelCannotOverrideCanonicalEvidence.blockers.some((entry) => entry.includes('participants.distinct-processes')));

const mutatedValidatorUnionFailsClosed = buildReplayDashboardSnapshot({
  ...validInput,
  validatorSeal: {
    ...validInput.validatorSeal,
    currentUnionDigest: 'sha256:mutated-after-reveal'
  }
});
assert.equal(mutatedValidatorUnionFailsClosed.readiness, 'not-ready');
assert.ok(mutatedValidatorUnionFailsClosed.blockers.some((entry) => entry.includes('validator.union-not-mutated')));

const incompleteAdmissionFacadeFailsClosed = buildReplayDashboardSnapshot({
  ...validInput,
  admissionFacadeDisposition: 'not-required'
});
assert.equal(incompleteAdmissionFacadeFailsClosed.readiness, 'not-ready');
assert.ok(incompleteAdmissionFacadeFailsClosed.blockers.some((entry) => entry.includes('admission.facade-required')));

const staleFallbackFailsClosed = buildReplayDashboardSnapshot({
  ...validInput,
  staleFallbackUsed: true,
  safeCompose: false
});
assert.equal(staleFallbackFailsClosed.readiness, 'not-ready');
assert.ok(staleFallbackFailsClosed.blockers.some((entry) => entry.includes('fallback.not-stale')));

console.log('plan3-dual-captain-dashboard tests passed');

function participant(participantId: string, actorId: string, processId: number) {
  return {
    participantId,
    provider: 'fixture-provider',
    role: 'captain',
    taskId: `task-${participantId}`,
    actorId,
    processId,
    laneSessionId: `lane-${participantId}`,
    worktreeRoot: 'C:/repo',
    baseDigest: 'sha256:base',
    headDigest: 'sha256:head',
    buildDigest: 'sha256:build',
    runnerDigest: 'sha256:runner',
    selectedTaskIds: [`task-${participantId}`],
    queuedTaskIds: [],
    ticketDigest: `sha256:ticket-${participantId}`,
    ticketGeneration: 1,
    waitedMs: 1,
    wakeup: 'auto' as const,
    authority: { lane: `lane-${participantId}`, takeover: false, borrowedActor: false },
    producerLabel: 'ignored'
  };
}

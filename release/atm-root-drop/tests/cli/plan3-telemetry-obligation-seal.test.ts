import assert from 'node:assert/strict';
import {
  buildParallelReplayTelemetryCoverageReport,
  sealParallelReplayTelemetryObligation
} from '../../packages/core/src/telemetry/parallel-replay/index.ts';
import {
  buildBrokerDecisionOutcomePair,
  classifyTelemetryCoverageState,
  registryMembershipSatisfiesCoverage
} from '../../packages/core/src/broker/replay/lifecycle-receipts.ts';

const registeredOnly = {
  nodeId: 'broker.shared-surface-admission',
  registered: true,
  codeWired: false,
  observedEventCount: 0,
  lastObservedAtMs: null,
  sealedReadBackCount: 0,
  lastSealedReadBackAtMs: null
};
assert.equal(classifyTelemetryCoverageState(registeredOnly), 'registered');
assert.equal(registryMembershipSatisfiesCoverage(registeredOnly), false);

const observed = {
  ...registeredOnly,
  codeWired: true,
  observedEventCount: 3,
  lastObservedAtMs: 100
};
assert.equal(classifyTelemetryCoverageState(observed), 'observed');
assert.equal(registryMembershipSatisfiesCoverage(observed), true);

const coverage = buildParallelReplayTelemetryCoverageReport([registeredOnly, observed]);
assert.equal(coverage.schemaId, 'atm.parallelReplayTelemetryCoverageReport.v1');
assert.equal(coverage.nodes[0].coverageSatisfied, false);
assert.equal(coverage.nodes[0].registryAloneSatisfies, false);
assert.equal(coverage.nodes[1].coverageSatisfied, true);
assert.match(coverage.digest, /^sha256:[a-f0-9]{64}$/);

const incomplete = sealParallelReplayTelemetryObligation({
  taskId: 'TASK-GENERIC-0002',
  declaredObligations: ['atm.gateTelemetryTaskSummary.v1', 'dataDrivenDecision']
});
assert.equal(incomplete.sealed, false);
assert.equal(incomplete.verdict, 'incomplete');
assert.deepEqual(incomplete.missingObligations, ['atm.gateTelemetryTaskSummary.v1', 'dataDrivenDecision']);
assert.equal(
  incomplete.recoveryCommand,
  'node atm.mjs telemetry --seal --task TASK-GENERIC-0002 --json'
);

const sealed = sealParallelReplayTelemetryObligation({
  taskId: 'TASK-GENERIC-0002',
  declaredObligations: ['atm.gateTelemetryTaskSummary.v1'],
  sealedSummaryDigest: `sha256:${'1'.repeat(64)}`,
  historyDigest: `sha256:${'2'.repeat(64)}`,
  configDigest: `sha256:${'3'.repeat(64)}`
});
assert.equal(sealed.sealed, true);
assert.equal(sealed.verdict, 'complete');
assert.equal(sealed.recoveryCommand, null);
assert.equal(sealed.compactEvidenceDigest, `sha256:${'1'.repeat(64)}`);

const unavailable = sealParallelReplayTelemetryObligation({
  taskId: 'TASK-GENERIC-0002',
  declaredObligations: ['atm.gateTelemetryTaskSummary.v1'],
  unavailableReceiptDigest: `sha256:${'4'.repeat(64)}`
});
assert.equal(unavailable.verdict, 'observability-missing');
assert.equal(unavailable.sealed, true);

const pair = buildBrokerDecisionOutcomePair({
  decisionClass: 'composer-routed',
  conflictAxes: ['path-overlap'],
  composeOrQueueResult: 'compose-selected',
  waitMs: 0,
  reworkCount: 0,
  ownerOverride: false,
  delayedCorrectnessOutcome: 'correct',
  outcomeRef: 'outcome:immutable:1'
});
assert.equal(pair.schemaId, 'atm.brokerDecisionOutcomePair.v1');
assert.equal(pair.outcomeRef, 'outcome:immutable:1');
assert.match(pair.digest, /^sha256:[a-f0-9]{64}$/);

assert.throws(
  () => buildBrokerDecisionOutcomePair({
    decisionClass: 'composer-routed',
    conflictAxes: [],
    composeOrQueueResult: 'compose-selected',
    waitMs: null,
    reworkCount: null,
    ownerOverride: false,
    delayedCorrectnessOutcome: 'unavailable',
    outcomeRef: ''
  }),
  /outcomeRef/
);

console.log('[plan3-telemetry-obligation-seal.test] ok');

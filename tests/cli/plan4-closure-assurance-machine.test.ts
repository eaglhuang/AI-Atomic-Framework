/**
 * ATM-GOV-0284 — ClosureAssuranceMachine reducer events.
 *
 * Case id: test_atm_gov_0284_closure_assurance_reducer_events_91afdb50
 *
 * Red predicate: replaying the same event stream must produce a different view,
 * duplicate events, or hide incomplete/blocked assurance state.
 */

import { strict as assert } from 'node:assert';
import {
  CLOSURE_ASSURANCE_MACHINE_ID,
  CLOSURE_ASSURANCE_VIEW_SCHEMA_ID,
  ClosureAssuranceMachine,
  QUALITY_GAUNTLET_EVENT_SCHEMA_ID,
  createQualityGauntletEvent,
  reduceClosureAssurance,
  type QualityGauntletEvent
} from '../../packages/core/src/evidence/closure-assurance-machine.ts';

const runId = 'plan4-run-1';
const checkpoint = 'close';

function event(input: Parameters<typeof createQualityGauntletEvent>[0]): QualityGauntletEvent {
  return createQualityGauntletEvent(input);
}

const started = event({ kind: 'assurance-started', runId, checkpoint, occurredAt: '2026-07-31T00:00:00.000Z' });
const observedA = event({
  kind: 'obligation-observed',
  runId,
  checkpoint,
  occurredAt: '2026-07-31T00:00:01.000Z',
  obligationId: 'atm.obligation:claim-adapter.a',
  semanticFamily: 'claim-adapter',
  owningSeam: 'atm.claimLifecycle.v1'
});
const observedB = event({
  kind: 'obligation-observed',
  runId,
  checkpoint,
  occurredAt: '2026-07-31T00:00:02.000Z',
  obligationId: 'atm.obligation:commit-adapter.b',
  semanticFamily: 'commit-adapter',
  owningSeam: 'atm.scopedCommit.v1'
});
const coveredA = event({
  kind: 'validator-progress',
  runId,
  checkpoint,
  occurredAt: '2026-07-31T00:00:03.000Z',
  obligationId: 'atm.obligation:claim-adapter.a',
  validatorCommand: 'node --strip-types tests/cli/lane-claim-conflict-matrix.test.ts',
  validatorCaseId: 'claim-lane-matrix',
  outcome: 'pass'
});

// --- events carry stable public fields (ACC-2, ACC-4) --------------------

assert.equal(started.schemaId, QUALITY_GAUNTLET_EVENT_SCHEMA_ID);
assert.equal(started.specVersion, '0.1.0');
assert.deepEqual(
  Object.keys(observedA).sort(),
  [
    'checkpoint', 'detail', 'eventId', 'kind', 'obligationId', 'occurredAt', 'outcome',
    'owningSeam', 'runId', 'schemaId', 'semanticFamily', 'specVersion', 'validatorCaseId', 'validatorCommand'
  ],
  'event shape is the public contract downstream selectors read'
);
assert.equal(
  event({ kind: 'obligation-observed', runId, checkpoint, occurredAt: '2026-07-31T00:00:01.000Z', obligationId: 'atm.obligation:claim-adapter.a', semanticFamily: 'claim-adapter', owningSeam: 'atm.claimLifecycle.v1' }).eventId,
  observedA.eventId,
  'the same observation must produce the same event id'
);
assert.notEqual(observedA.eventId, observedB.eventId);

// --- replay determinism and idempotency (ACC-2, ACC-5) -------------------

const stream: readonly QualityGauntletEvent[] = [started, observedA, observedB, coveredA];
const machine = new ClosureAssuranceMachine({ runId, checkpoint });
for (const item of stream) machine.apply(item);
const live = machine.view();
const replayed = reduceClosureAssurance({ runId, checkpoint, events: stream });

assert.equal(live.schemaId, CLOSURE_ASSURANCE_VIEW_SCHEMA_ID);
assert.equal(live.machineId, CLOSURE_ASSURANCE_MACHINE_ID);
assert.equal(live.viewDigest, replayed.viewDigest, 'replaying the recorded stream must reconstruct the same view');
assert.deepEqual(live.obligations, replayed.obligations);

const withDuplicates = reduceClosureAssurance({ runId, checkpoint, events: [...stream, observedA, coveredA] });
assert.equal(withDuplicates.viewDigest, live.viewDigest, 'duplicate events must not change the view');
assert.deepEqual(withDuplicates.duplicateEventIds, [coveredA.eventId, observedA.eventId].sort());
assert.deepEqual(
  withDuplicates.diagnostics.map((finding) => finding.code),
  ['ATM_ASSURANCE_DUPLICATE_EVENT', 'ATM_ASSURANCE_DUPLICATE_EVENT']
);

// --- partial progress survives every state (ACC-3) -----------------------

assert.equal(live.state, 'running');
assert.equal(live.terminal, false);
assert.deepEqual(
  live.obligations.map((entry) => `${entry.obligationId}:${entry.status}`),
  ['atm.obligation:claim-adapter.a:covered', 'atm.obligation:commit-adapter.b:pending']
);
assert.deepEqual(live.progress, { total: 2, covered: 1, pending: 1, unknown: 0, excluded: 0, counterexample: 0 });

const stopEvent = event({ kind: 'assurance-stopped', runId, checkpoint, occurredAt: '2026-07-31T00:00:09.000Z' });
const openStop = reduceClosureAssurance({ runId, checkpoint, events: [...stream, stopEvent] });
assert.equal(openStop.state, 'indeterminate', 'stopping with open obligations is indeterminate, not proven');
assert.equal(openStop.terminal, true);
assert.deepEqual(openStop.diagnostics.map((finding) => finding.code), ['ATM_ASSURANCE_STOP_WITH_OPEN_OBLIGATIONS']);
assert.deepEqual(
  openStop.obligations.map((entry) => entry.status),
  ['covered', 'pending'],
  'a terminal verdict must not discard partial progress'
);

const coveredB = event({
  kind: 'validator-progress',
  runId,
  checkpoint,
  occurredAt: '2026-07-31T00:00:04.000Z',
  obligationId: 'atm.obligation:commit-adapter.b',
  validatorCommand: 'node --strip-types tests/cli/commit-attribution-sealed-transaction.test.ts',
  outcome: 'pass'
});
const proven = reduceClosureAssurance({ runId, checkpoint, events: [...stream, coveredB, stopEvent] });
assert.equal(proven.state, 'stopped-proven');
assert.equal(proven.verdict, 'proven');

const excludedB = event({
  kind: 'obligation-observed',
  runId,
  checkpoint,
  occurredAt: '2026-07-31T00:00:02.000Z',
  obligationId: 'atm.obligation:commit-adapter.b',
  semanticFamily: 'commit-adapter',
  owningSeam: 'atm.scopedCommit.v1',
  outcome: 'excluded',
  detail: 'excluded from this checkpoint'
});
const sufficient = reduceClosureAssurance({
  runId,
  checkpoint,
  events: [started, observedA, excludedB, coveredA, stopEvent]
});
assert.equal(sufficient.state, 'stopped-sufficient', 'covered plus explicitly excluded obligations is sufficient');
assert.equal(sufficient.verdict, 'sufficient');
assert.deepEqual(sufficient.progress, { total: 2, covered: 1, pending: 0, unknown: 0, excluded: 1, counterexample: 0 });

const counterexample = event({
  kind: 'counterexample-found',
  runId,
  checkpoint,
  occurredAt: '2026-07-31T00:00:05.000Z',
  obligationId: 'atm.obligation:commit-adapter.b',
  validatorCommand: 'node --strip-types tests/cli/commit-attribution-sealed-transaction.test.ts',
  detail: 'sealed bundle mismatch'
});
const blocked = reduceClosureAssurance({ runId, checkpoint, events: [...stream, counterexample] });
assert.equal(blocked.state, 'blocked-counterexample');
assert.equal(blocked.terminal, true);
assert.equal(blocked.verdict, 'blocked');
assert.deepEqual(blocked.counterexamples.map((entry) => entry.obligationId), ['atm.obligation:commit-adapter.b']);
assert.equal(blocked.progress.covered, 1, 'a counterexample must not erase what was already proven');

const indeterminate = reduceClosureAssurance({
  runId,
  checkpoint,
  events: [...stream, event({ kind: 'assurance-indeterminate', runId, checkpoint, occurredAt: '2026-07-31T00:00:06.000Z', detail: 'validator host unavailable' })]
});
assert.equal(indeterminate.state, 'indeterminate');
assert.equal(indeterminate.terminal, true);
assert.equal(indeterminate.progress.covered, 1);

// --- invalid transitions are diagnostics, never silent loss (ACC-5) ------

const afterTerminal = reduceClosureAssurance({ runId, checkpoint, events: [...stream, counterexample, coveredB] });
assert.equal(afterTerminal.state, 'blocked-counterexample', 'a terminal run cannot be reopened by a later event');
assert.deepEqual(afterTerminal.diagnostics.map((finding) => finding.code), ['ATM_ASSURANCE_EVENT_AFTER_TERMINAL']);
assert.deepEqual(afterTerminal.obligations.map((entry) => entry.status), ['covered', 'counterexample']);

const foreign = reduceClosureAssurance({
  runId,
  checkpoint,
  events: [...stream, event({ kind: 'validator-progress', runId: 'other-run', checkpoint, occurredAt: '2026-07-31T00:00:07.000Z', obligationId: 'atm.obligation:commit-adapter.b', validatorCommand: 'x', outcome: 'pass' })]
});
assert.deepEqual(foreign.diagnostics.map((finding) => finding.code), ['ATM_ASSURANCE_RUN_MISMATCH']);
assert.equal(foreign.viewDigest, live.viewDigest, "another run's event must not leak into this view");

const unknownObligation = reduceClosureAssurance({
  runId,
  checkpoint,
  events: [started, event({ kind: 'validator-progress', runId, checkpoint, occurredAt: '2026-07-31T00:00:08.000Z', obligationId: 'atm.obligation:never-observed', validatorCommand: 'x', outcome: 'pass' })]
});
assert.deepEqual(unknownObligation.diagnostics.map((finding) => finding.code), ['ATM_ASSURANCE_UNKNOWN_OBLIGATION']);
assert.deepEqual(unknownObligation.obligations.map((entry) => entry.status), ['unknown']);
assert.equal(unknownObligation.state, 'running', 'an unknown obligation is reported, not fatal');

console.log(JSON.stringify({
  marker: '[plan4-closure-assurance-machine:test] ok',
  caseId: 'test_atm_gov_0284_closure_assurance_reducer_events_91afdb50',
  viewDigest: live.viewDigest,
  states: [live.state, proven.state, sufficient.state, blocked.state, indeterminate.state]
}));

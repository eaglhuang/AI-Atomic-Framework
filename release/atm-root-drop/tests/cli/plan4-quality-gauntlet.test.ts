/**
 * ATM-GOV-0284 — QualityGauntlet facade contract.
 *
 * Case id: test_atm_gov_0284_quality_gauntlet_facade_contract_2ef36d44
 *
 * Red predicate: callers must not need ClosureAssuranceMachine private state to
 * advance, inspect, or replay a quality run.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  QUALITY_GAUNTLET_ID,
  QUALITY_GAUNTLET_TRANSITION_SCHEMA_ID,
  QualityGauntlet,
  type QualityGauntletRequest
} from '../../packages/core/src/evidence/quality-gauntlet.ts';
import { QUALITY_GAUNTLET_EVENT_SCHEMA_ID } from '../../packages/core/src/evidence/closure-assurance-machine.ts';
import * as evidenceIndex from '../../packages/core/src/evidence/index.ts';

const runId = 'plan4-gauntlet-1';

const start: QualityGauntletRequest = {
  runId,
  checkpoint: 'close',
  requestedAt: '2026-07-31T00:00:00.000Z',
  obligations: [
    { obligationId: 'atm.obligation:claim-adapter.a', semanticFamily: 'claim-adapter', owningSeam: 'atm.claimLifecycle.v1' },
    { obligationId: 'atm.obligation:commit-adapter.b', semanticFamily: 'commit-adapter', owningSeam: 'atm.scopedCommit.v1' }
  ],
  validatorResults: [
    {
      command: 'node --strip-types tests/cli/lane-claim-conflict-matrix.test.ts',
      caseId: 'claim-lane-matrix',
      outcome: 'pass',
      obligationIds: ['atm.obligation:claim-adapter.a']
    }
  ]
};

// --- advance / inspect / replay are the whole public surface (ACC-1) -----

const gauntlet = new QualityGauntlet();
assert.deepEqual(
  Object.getOwnPropertyNames(QualityGauntlet.prototype).filter((name) => name !== 'constructor').sort(),
  ['advance', 'inspect', 'replay'],
  'the facade must expose exactly advance, inspect and replay'
);

const first = gauntlet.advance(start);
assert.equal(first.schemaId, QUALITY_GAUNTLET_TRANSITION_SCHEMA_ID);
assert.equal(first.gauntletId, QUALITY_GAUNTLET_ID);
assert.equal(first.fromState, 'running');
assert.equal(first.toState, 'running');
assert.equal(first.terminal, false);
assert.equal(first.verdict, 'in-progress');
assert.equal(first.view.progress.covered, 1);
assert.equal(first.view.progress.pending, 1);

// --- a resumed run continues from recorded events, not caller memory ----

const second = gauntlet.advance({
  runId,
  checkpoint: 'close',
  requestedAt: '2026-07-31T00:01:00.000Z',
  obligations: [],
  validatorResults: [
    {
      command: 'node --strip-types tests/cli/commit-attribution-sealed-transaction.test.ts',
      outcome: 'pass',
      obligationIds: ['atm.obligation:commit-adapter.b']
    }
  ],
  stop: 'stop'
});
assert.equal(second.fromState, 'running');
assert.equal(second.toState, 'stopped-proven');
assert.equal(second.terminal, true);
assert.equal(second.verdict, 'proven');
assert.equal(second.view.progress.covered, 2);

// --- inspect exposes the public view and event log only (ACC-1, ACC-4) --

const inspected = gauntlet.inspect(runId);
assert.ok(inspected, 'a started run must be inspectable by id');
assert.equal(inspected.view.viewDigest, second.view.viewDigest);
assert.equal(gauntlet.inspect('never-started'), null);
for (const item of inspected.events) {
  assert.equal(item.schemaId, QUALITY_GAUNTLET_EVENT_SCHEMA_ID);
  assert.ok(typeof item.eventId === 'string' && item.eventId.length > 0);
  assert.equal(item.runId, runId);
}
assert.deepEqual(
  [...new Set(inspected.events.map((item) => item.kind))].sort(),
  ['assurance-started', 'assurance-stopped', 'obligation-observed', 'validator-progress'],
  'downstream selectors read event kinds, not reducer internals'
);
// ATM-GOV-0285 selects validators from public event fields alone.
const selectable = inspected.events
  .filter((item) => item.kind === 'validator-progress' && item.outcome === 'pass')
  .map((item) => `${item.validatorCommand}#${item.obligationId}`);
assert.deepEqual(selectable, [
  'node --strip-types tests/cli/lane-claim-conflict-matrix.test.ts#atm.obligation:claim-adapter.a',
  'node --strip-types tests/cli/commit-attribution-sealed-transaction.test.ts#atm.obligation:commit-adapter.b'
]);

// --- replay reconstructs the same view from the events alone (ACC-2) ----

const report = gauntlet.replay({ runId, checkpoint: 'close', events: inspected.events });
assert.equal(report.view.viewDigest, inspected.view.viewDigest, 'replay must reconstruct the recorded view exactly');
assert.equal(report.replayedEventCount, inspected.events.length);
assert.deepEqual(report.duplicateEventIds, []);
assert.equal(report.deterministic, true);

const detached = new QualityGauntlet().replay({ runId, checkpoint: 'close', events: inspected.events });
assert.equal(detached.view.viewDigest, report.view.viewDigest, 'replay must not depend on facade instance state');

const shuffled = new QualityGauntlet().replay({
  runId,
  checkpoint: 'close',
  events: [...inspected.events, ...inspected.events]
});
assert.equal(shuffled.view.viewDigest, report.view.viewDigest, 'a duplicated event log replays to the same view');
assert.equal(shuffled.duplicateEventIds.length, inspected.events.length);

// --- a blocked run reports its counterexample through the facade (ACC-3)

const blockedRun = new QualityGauntlet().advance({
  runId: 'plan4-gauntlet-blocked',
  checkpoint: 'release',
  requestedAt: '2026-07-31T00:02:00.000Z',
  obligations: [
    { obligationId: 'atm.obligation:commit-adapter.b', semanticFamily: 'commit-adapter', owningSeam: 'atm.scopedCommit.v1' }
  ],
  validatorResults: [
    {
      command: 'node --strip-types tests/cli/commit-attribution-sealed-transaction.test.ts',
      outcome: 'fail',
      obligationIds: ['atm.obligation:commit-adapter.b'],
      detail: 'sealed bundle mismatch'
    }
  ]
});
assert.equal(blockedRun.toState, 'blocked-counterexample');
assert.equal(blockedRun.verdict, 'blocked');
assert.equal(blockedRun.view.counterexamples.length, 1);

const indeterminateRun = new QualityGauntlet().advance({
  runId: 'plan4-gauntlet-indeterminate',
  checkpoint: 'phase',
  requestedAt: '2026-07-31T00:03:00.000Z',
  obligations: [
    { obligationId: 'atm.obligation:claim-adapter.a', semanticFamily: 'claim-adapter', owningSeam: 'atm.claimLifecycle.v1' }
  ],
  validatorResults: [],
  stop: 'indeterminate',
  stopReason: 'validator host unavailable'
});
assert.equal(indeterminateRun.toState, 'indeterminate');
assert.equal(indeterminateRun.verdict, 'indeterminate');
assert.equal(indeterminateRun.view.progress.pending, 1, 'partial progress survives an indeterminate stop');

// --- the seam is exported and schema/catalog bound ----------------------

assert.equal(typeof evidenceIndex.QualityGauntlet, 'function');
assert.equal(typeof evidenceIndex.reduceClosureAssurance, 'function');

const schemaText = readFileSync('schemas/evidence/quality-gauntlet.schema.json', 'utf8');
assert(schemaText.includes('"atm.qualityGauntletTransition.v1"'));
assert(schemaText.includes('"blocked-counterexample"'));
assert(schemaText.includes('"stopped-sufficient"'));

const catalogText = readFileSync('tests/catalog/groups/test_group_plan4_quality_gauntlet.shard.json', 'utf8');
assert(catalogText.includes('test_atm_gov_0284_quality_gauntlet_facade_contract_2ef36d44'));
assert(catalogText.includes('test_atm_gov_0284_closure_assurance_reducer_events_91afdb50'));

console.log(JSON.stringify({
  marker: '[plan4-quality-gauntlet:test] ok',
  caseId: 'test_atm_gov_0284_quality_gauntlet_facade_contract_2ef36d44',
  transitionDigest: second.transitionDigest,
  verdicts: [first.verdict, second.verdict, blockedRun.verdict, indeterminateRun.verdict]
}));

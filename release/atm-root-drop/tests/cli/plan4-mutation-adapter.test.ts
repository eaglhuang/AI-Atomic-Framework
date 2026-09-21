/**
 * ATM-GOV-0306 — pinned mutation adapter and replayable lineage.
 *
 * Case id: test_atm_gov_0306_replayable_mutation_lineage_7c2e91a4
 *
 * Red predicate: Mutation observations omit mutant id, seed/digest, or
 * lower/upper bounds, or are not replayable.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  MUTATION_ADAPTER_SCHEMA_ID,
  MUTATION_LINEAGE_SCHEMA_ID,
  PINNED_IN_PROCESS_MUTATION_ADAPTER_ID,
  ATM_MUTATION_PROBE_WINDOW_VIOLATION,
  createPinnedInProcessMutationAdapter,
  replayMutationLineage,
  runMutationAdapter
} from '../../packages/core/src/evidence/mutation-lineage.ts';

const adapter = createPinnedInProcessMutationAdapter({
  pin: 'sha256:fixture-pin-0306-adapter',
  capability: 'supported'
});

assert.equal(adapter.schemaId, MUTATION_ADAPTER_SCHEMA_ID);
assert.equal(adapter.adapterId, PINNED_IN_PROCESS_MUTATION_ADAPTER_ID);
assert.equal(adapter.pin, 'sha256:fixture-pin-0306-adapter');

const probeWindow = {
  taskId: 'ATM-GOV-0306',
  selectionDigest: 'sha256:0285-selection-digest-fixture',
  allowedProbeIds: ['probe-a', 'probe-b']
};

const report = runMutationAdapter({
  adapter,
  probeWindow,
  observations: [
    {
      mutantId: 'mut-survived-non-eq',
      probeId: 'probe-b',
      seed: 'seed-2',
      outcome: 'survived',
      behavioralDigest: 'behavior-mutated',
      originalBehavioralDigest: 'behavior-original'
    },
    {
      mutantId: 'mut-killed',
      probeId: 'probe-a',
      seed: 'seed-1',
      outcome: 'killed'
    }
  ]
});

assert.equal(report.schemaId, MUTATION_LINEAGE_SCHEMA_ID);
assert.equal(report.ok, true);
assert.equal(report.verdict, 'evidence-ready');
assert.equal(report.closeAuthorization, 'denied', 'adapter evidence must never authorize close');
assert.equal(report.selectionDigest, probeWindow.selectionDigest);
assert.equal(report.adapterPin, adapter.pin);

// ACC-2: every record carries mutant id, outcome, bounds, seed, digest.
assert.deepEqual(
  report.records.map((record) => record.mutantId),
  ['mut-killed', 'mut-survived-non-eq'],
  'records are sorted by mutant id for stable digests'
);
for (const record of report.records) {
  assert.ok(record.mutantId.length > 0);
  assert.ok(record.seed.length > 0);
  assert.match(record.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(record.lowerBound, report.bounds.lowerBound);
  assert.equal(record.upperBound, report.bounds.upperBound);
  assert.ok(record.lowerBound <= record.upperBound);
}

assert.equal(report.bounds.killed, 1);
assert.equal(report.bounds.survived, 1);
assert.equal(report.bounds.total, 2);
assert.equal(report.bounds.lowerBound, 0.5);
assert.equal(report.bounds.upperBound, 0.5);

const replay = replayMutationLineage({ report });
assert.equal(replay.ok, true, 'sealed lineage must replay from digest');
assert.equal(replay.deterministic, true);
assert.equal(replay.recomputedLineageDigest, report.lineageDigest);

// ACC-1: observations outside the 0285-selected probe window fail closed.
const outsideWindow = runMutationAdapter({
  adapter,
  probeWindow,
  observations: [
    {
      mutantId: 'mut-outside',
      probeId: 'probe-not-selected',
      seed: 'seed-x',
      outcome: 'killed'
    }
  ]
});
assert.equal(outsideWindow.ok, false);
assert.equal(outsideWindow.verdict, 'fail-closed');
assert.equal(outsideWindow.failClosed?.code, ATM_MUTATION_PROBE_WINDOW_VIOLATION);
assert.equal(outsideWindow.closeAuthorization, 'denied');

// Empty probe window is also fail-closed.
const emptyWindow = runMutationAdapter({
  adapter,
  probeWindow: { taskId: 'ATM-GOV-0306', selectionDigest: '', allowedProbeIds: [] },
  observations: []
});
assert.equal(emptyWindow.ok, false);
assert.equal(emptyWindow.verdict, 'fail-closed');
assert.equal(emptyWindow.failClosed?.code, ATM_MUTATION_PROBE_WINDOW_VIOLATION);

// Schema contract is present for the lineage report shape.
const schema = JSON.parse(readFileSync('schemas/evidence/mutation-lineage.schema.json', 'utf8')) as {
  properties: { schemaId: { const: string }; closeAuthorization: { const: string } };
};
assert.equal(schema.properties.schemaId.const, MUTATION_LINEAGE_SCHEMA_ID);
assert.equal(schema.properties.closeAuthorization.const, 'denied');

console.log('plan4-mutation-adapter: ok');

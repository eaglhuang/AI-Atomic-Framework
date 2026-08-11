/**
 * ATM-GOV-0306 — equivalence governance and fail-closed adapter paths.
 *
 * Case id: test_atm_gov_0306_equivalence_and_fail_closed_adapter_9b18d0e3
 *
 * Red predicate: Equivalent survivors are treated as non-equivalent,
 * unsupported adapters return pass, or lineage becomes the sole close
 * authority for ATM-GOV-0293.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  ATM_MUTATION_ADAPTER_INCONCLUSIVE,
  ATM_MUTATION_ADAPTER_UNSUPPORTED,
  MUTATION_FAMILY_MATCH_EVIDENCE_SCHEMA_ID,
  classifySurvivorEquivalence,
  createPinnedInProcessMutationAdapter,
  runMutationAdapter,
  toFamilyMatchEvidence
} from '../../packages/core/src/evidence/mutation-lineage.ts';

const probeWindow = {
  taskId: 'ATM-GOV-0306',
  selectionDigest: 'sha256:0285-selection-digest-fixture',
  allowedProbeIds: ['probe-a']
};

assert.equal(
  classifySurvivorEquivalence({
    outcome: 'killed'
  }),
  'not-applicable'
);
assert.equal(
  classifySurvivorEquivalence({
    outcome: 'survived',
    behavioralDigest: 'same',
    originalBehavioralDigest: 'same'
  }),
  'equivalent'
);
assert.equal(
  classifySurvivorEquivalence({
    outcome: 'survived',
    behavioralDigest: 'mutated',
    originalBehavioralDigest: 'original'
  }),
  'non-equivalent'
);
assert.equal(
  classifySurvivorEquivalence({
    outcome: 'survived',
    behavioralDigest: null,
    originalBehavioralDigest: 'original'
  }),
  'non-equivalent',
  'missing survivor digests must not be treated as equivalent'
);

const adapter = createPinnedInProcessMutationAdapter({
  pin: 'sha256:fixture-pin-0306-equivalence'
});

const report = runMutationAdapter({
  adapter,
  probeWindow,
  observations: [
    {
      mutantId: 'mut-killed',
      probeId: 'probe-a',
      seed: 'seed-k',
      outcome: 'killed'
    },
    {
      mutantId: 'mut-eq',
      probeId: 'probe-a',
      seed: 'seed-e',
      outcome: 'survived',
      behavioralDigest: 'behavior-a',
      originalBehavioralDigest: 'behavior-a'
    },
    {
      mutantId: 'mut-neq',
      probeId: 'probe-a',
      seed: 'seed-n',
      outcome: 'survived',
      behavioralDigest: 'behavior-b',
      originalBehavioralDigest: 'behavior-a'
    }
  ]
});

assert.equal(report.ok, true);
assert.deepEqual(
  report.records.map((record) => `${record.mutantId}:${record.outcome}:${record.equivalence}`),
  [
    'mut-eq:survived:equivalent',
    'mut-killed:killed:not-applicable',
    'mut-neq:survived:non-equivalent'
  ]
);
assert.equal(report.bounds.killed, 1);
assert.equal(report.bounds.equivalent, 1);
assert.equal(report.bounds.nonEquivalent, 1);
assert.equal(report.bounds.lowerBound, 1 / 3);
assert.equal(report.bounds.upperBound, 2 / 3);
assert.equal(report.closeAuthorization, 'denied');

// ACC-5: 0293 may consume lineage, but never as sole matching authority.
const familyEvidence = toFamilyMatchEvidence(report);
assert.equal(familyEvidence.schemaId, MUTATION_FAMILY_MATCH_EVIDENCE_SCHEMA_ID);
assert.equal(familyEvidence.soleMatchingAuthority, false);
assert.equal(familyEvidence.authorityRole, 'supporting-evidence-only');
assert.equal(familyEvidence.mayStrengthenOrWeakenConfidence, true);
assert.deepEqual(
  familyEvidence.survivors.map((entry) => `${entry.mutantId}:${entry.equivalence}`),
  ['mut-eq:equivalent', 'mut-neq:non-equivalent']
);
assert.deepEqual(familyEvidence.killedMutantIds, ['mut-killed']);

// ACC-4: unsupported / inconclusive adapters fail closed and must not pass.
const unsupported = runMutationAdapter({
  adapter: createPinnedInProcessMutationAdapter({
    pin: 'sha256:unsupported',
    capability: 'unsupported'
  }),
  probeWindow,
  observations: [
    {
      mutantId: 'mut-x',
      probeId: 'probe-a',
      seed: 'seed-x',
      outcome: 'killed'
    }
  ]
});
assert.equal(unsupported.ok, false);
assert.equal(unsupported.verdict, 'fail-closed');
assert.notEqual(unsupported.verdict as string, 'pass');
assert.equal(unsupported.failClosed?.code, ATM_MUTATION_ADAPTER_UNSUPPORTED);
assert.equal(unsupported.closeAuthorization, 'denied');
assert.deepEqual(unsupported.records, []);

const inconclusive = runMutationAdapter({
  adapter: createPinnedInProcessMutationAdapter({
    pin: 'sha256:inconclusive',
    capability: 'inconclusive'
  }),
  probeWindow,
  observations: []
});
assert.equal(inconclusive.ok, false);
assert.equal(inconclusive.verdict, 'fail-closed');
assert.equal(inconclusive.failClosed?.code, ATM_MUTATION_ADAPTER_INCONCLUSIVE);

// Catalog shard registers both required case ids for this task.
const shard = JSON.parse(
  readFileSync('tests/catalog/groups/test_group_plan4_mutation_lineage.shard.json', 'utf8')
) as { groupId: string; cases: Array<{ caseId: string }>; legacyAliases: Array<{ legacyCaseId: string; canonicalCaseId: string }> };
assert.equal(shard.groupId, 'test_group_plan4_mutation_lineage');
assert.ok(shard.cases.some((entry) => entry.caseId === 'test_task_atm_gov_0306_replayable_mutation_lineage_08bf66e4'));
assert.ok(shard.cases.some((entry) => entry.caseId === 'test_task_atm_gov_0306_equivalence_and_fail_closed_adapter_3a04d6af'));
assert.ok(shard.legacyAliases.some((entry) =>
  entry.legacyCaseId === 'test_atm_gov_0306_replayable_mutation_lineage_7c2e91a4'
  && entry.canonicalCaseId === 'test_task_atm_gov_0306_replayable_mutation_lineage_08bf66e4'
));

console.log('plan4-mutation-lineage-equivalence: ok');

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import {
  auditPrfDependencyCensus,
  evaluateHardCausalAdmission,
  missingHardCausalFacts,
  resolvePlanningRoot
} from '../../scripts/audit-task-dependency-semantics.ts';

const census = auditPrfDependencyCensus({
  planningRoot: resolvePlanningRoot(),
  targetRoot: resolve('.'),
  generatedAt: '2026-08-22T15:55:01.258Z'
});

assert.equal(census.schemaId, 'atm.plan41DependencyCensus.v1');
assert.deepEqual(census.sampleTaskIds, ['TASK-PRF-0002', 'TASK-PRF-0003']);
assert.equal(census.unclassifiedEdgeIds.length, 0);
assert.equal(census.counts.unclassified, 0);
assert.ok(census.counts.denominator > 0, 'census denominator must be > 0');
assert.equal(census.counts.denominator, census.edges.length);
assert.equal(census.hardDependencyRate.numerator, census.counts.hardCausal);
assert.equal(census.hardDependencyRate.denominator, census.counts.denominator);
assert.equal(census.hardDependencyRate.quotaTargetRejected, true);
assert.equal(census.antiGaming.quotaRelabelingDetected, false);

const dep = census.edges.find((edge) => edge.producer === 'TASK-PRF-0002' && edge.consumer === 'TASK-PRF-0003' && edge.sourceFields.includes('depends_on'));
assert.ok(dep, 'PRF-0003 must declare a relation to PRF-0002');
assert.equal(dep.lifecycleType, 'validation');
assert.equal(dep.hardCausalProven, false);
assert.equal(dep.declaredAsHard, true);
assert.ok(dep.missingHardFacts.length > 0);
assert.equal(dep.planningAuthorityUnchanged, true);

const soft = census.edges.find((edge) => edge.producer === 'TASK-PRF-0002' && edge.consumer === 'TASK-PRF-0003' && edge.sourceFields.includes('causalGraph.softRelations'));
assert.ok(soft);
assert.equal(soft.lifecycleType, 'soft-order');

assert.equal(census.edges.filter((edge) => edge.lifecycleType === 'hard-causal').length, 0);
assert.ok(census.counts.unprovenHardDeclarations >= 1);

const incomplete = evaluateHardCausalAdmission(null, false);
assert.equal(incomplete.claim, 'allowed');
assert.ok(missingHardCausalFacts(null).length >= 6);

console.log('[task-dependency-semantics-census.test] ok');
console.log(JSON.stringify({
  denominator: census.counts.denominator,
  hardCausal: census.counts.hardCausal,
  observedRate: census.hardDependencyRate.observed,
  digest: census.digest
}));

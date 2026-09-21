import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  auditPrfDependencyCensus,
  evaluateHardCausalAdmission,
  missingHardCausalFacts
} from '../../scripts/audit-task-dependency-semantics.ts';

// The census used to be taken over the live planning repository, which a CI
// clone does not have beside it, so the denominator was 0 and the test could
// only pass on a maintainer's machine. What it is really checking is how the
// classifier treats a declared dependency that proves none of the hard-causal
// facts, so give it a planning root that states exactly that.
const planningRoot = mkdtempSync(join(tmpdir(), 'atm-dependency-census-'));
try {
  const tasksDir = join(planningRoot, 'docs/ai_atomic_framework/atm-product-proof/tasks');
  mkdirSync(tasksDir, { recursive: true });

  // Producer: declares a soft ordering hint towards the consumer and nothing else.
  writeFileSync(join(tasksDir, 'TASK-PRF-0002-fixture-producer.task.md'), [
    '---',
    'task_id: TASK-PRF-0002',
    'depends_on: []',
    'deliverables:',
    '  - packages/cli/src/fixture-producer.ts',
    'causalGraph:',
    '  causalDependencies: []',
    '  softRelations: [TASK-PRF-0003]',
    '  startConditions: []',
    '  parallelFrontierInputs: []',
    '---',
    '',
    'Fixture producer card.',
    ''
  ].join('\n'), 'utf8');

  // Consumer: declares the producer as a hard causal dependency while shipping a
  // product-CI workflow, which is the shape that classifies as validation rather
  // than hard-causal -- waiting at validate/close, not proving causation.
  writeFileSync(join(tasksDir, 'TASK-PRF-0003-fixture-consumer.task.md'), [
    '---',
    'task_id: TASK-PRF-0003',
    'depends_on: [TASK-PRF-0002]',
    'deliverables:',
    '  - .github/workflows/ci.yml',
    'causalGraph:',
    '  causalDependencies: [TASK-PRF-0002]',
    '  softRelations: []',
    '  startConditions: []',
    '  parallelFrontierInputs: []',
    '---',
    '',
    'Fixture consumer card whose deliverable is a product-CI workflow.',
    ''
  ].join('\n'), 'utf8');

  const census = auditPrfDependencyCensus({
    planningRoot,
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

  // A dependency can be declared hard and still prove nothing. That is the case
  // the census exists to make visible, so it must not be counted as hard-causal.
  const declared = census.edges.find((edge) => edge.sourceFields.includes('depends_on'));
  assert.ok(declared, 'the declared dependency must produce an edge');
  assert.equal(declared.producer, 'TASK-PRF-0002');
  assert.equal(declared.consumer, 'TASK-PRF-0003');
  assert.equal(declared.lifecycleType, 'validation');
  assert.equal(declared.declaredAsHard, true);
  assert.equal(declared.hardCausalProven, false);
  assert.ok(declared.missingHardFacts.length > 0);
  assert.equal(declared.planningAuthorityUnchanged, true);

  const soft = census.edges.find((edge) => edge.sourceFields.includes('causalGraph.softRelations'));
  assert.ok(soft, 'the soft relation must produce its own edge');
  assert.equal(soft.lifecycleType, 'soft-order');
  assert.equal(soft.declaredAsHard, false);

  assert.equal(census.edges.filter((edge) => edge.lifecycleType === 'hard-causal').length, 0);
  assert.ok(census.counts.unprovenHardDeclarations >= 1);
} finally {
  rmSync(planningRoot, { recursive: true, force: true });
}

// Incomplete facts admit rather than block: the census reports, it does not gate.
const incomplete = evaluateHardCausalAdmission(null, false);
assert.equal(incomplete.claim, 'allowed');
assert.ok(missingHardCausalFacts(null).length >= 6);

console.log('[task-dependency-semantics-census.test] ok');

import assert from 'node:assert/strict';
import {
  computeAggregateInputTreeHash,
  evaluateSealContinuity,
  classifyRunnerAffectingPaths,
  RUNNER_SYNC_ERROR_CODES,
  RUNNER_INPUT_GRAPH_SCHEMA,
  type RunnerInputGraph,
  type RunnerInputGraphNode
} from '../../packages/core/src/broker/runner-version-contract.ts';

// Deterministic fixtures (ATM-GOV-0266 Phase A): a two-segment input graph.
const SEAL = 'c'.repeat(40);
const nodes: readonly RunnerInputGraphNode[] = [
  { segment: 'packages', inputPaths: ['packages/core/src/broker/runner-sync-session.ts'], inputDigest: 'sha256:pin', outputEntries: ['packages/core'], outputDigest: 'sha256:pout' },
  { segment: 'schemas', inputPaths: ['schemas/validators/runner-version-selection-receipt.schema.json'], inputDigest: 'sha256:scin', outputEntries: ['release/atm-root-drop/schemas'], outputDigest: 'sha256:scout' }
];
const graph: RunnerInputGraph = {
  schemaId: RUNNER_INPUT_GRAPH_SCHEMA,
  sealedSourceSha: SEAL,
  nodes,
  aggregateInputTreeHash: computeAggregateInputTreeHash(nodes)
};

// 1. Non-runner-affecting delta (planning/backlog/ledger) stays continuous.
{
  const result = evaluateSealContinuity({
    graph,
    headDeltaPaths: [
      'docs/governance/atm-bug-and-optimization-backlog.md',
      '.atm/history/tasks/ATM-GOV-0266.json'
    ]
  });
  assert.equal(result.continuous, true);
  assert.equal(result.revalidationRequired, false);
  assert.equal(result.errorCode, null);
  assert.equal(result.affectedClosure.length, 0);
}

// 2. Runner-affecting delta in a graphed segment → revalidate only that closure.
{
  const result = evaluateSealContinuity({
    graph,
    headDeltaPaths: ['packages/core/src/broker/runner-sync-session.ts']
  });
  assert.equal(result.continuous, false);
  assert.equal(result.revalidationRequired, true);
  assert.equal(result.errorCode, RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired);
  assert.deepEqual([...result.affectedClosure], ['packages']);
}

// 3. Runner-affecting delta with no graph owner → fail closed, full refresh.
{
  const result = evaluateSealContinuity({
    graph,
    headDeltaPaths: ['scripts/run-sealed-runner-build.ts']
  });
  assert.equal(result.revalidationRequired, true);
  assert.equal(result.errorCode, RUNNER_SYNC_ERROR_CODES.sealRevalidationRequired);
  assert.match(result.reason, /no valid input-graph owner/);
}

// 4. Mixed delta: any runner-affecting path forces revalidation.
{
  const result = evaluateSealContinuity({
    graph,
    headDeltaPaths: ['docs/plan.md', 'packages/core/src/broker/runner-version-registry.ts']
  });
  assert.equal(result.continuous, false);
  assert.deepEqual([...result.affectedClosure], ['packages']);
}

// 5. Classifier is stable/sorted and separates the two buckets.
{
  const classification = classifyRunnerAffectingPaths([
    'templates/skills/x.md',
    'README.md',
    'schemas/y.json',
    'docs/z.md'
  ]);
  assert.deepEqual([...classification.runnerAffecting], ['schemas/y.json', 'templates/skills/x.md']);
  assert.deepEqual([...classification.nonRunnerAffecting], ['docs/z.md', 'README.md']);
  assert.deepEqual([...classification.affectedSegments], ['schemas', 'templates']);
}

console.log('runner-sync-sealed-input-continuity.test.ts: assertions passed');

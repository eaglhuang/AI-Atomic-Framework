import assert from 'node:assert/strict';
import {
  buildParallelReplayScenario,
  evaluateParallelReplayScenario
} from '../../packages/core/src/schemas/parallel-replay-scenario.ts';

const scenario = buildParallelReplayScenario({
  scenarioId: 'atm-gov-0226-red-baseline',
  generatedAt: '2026-07-21T00:00:00.000Z',
  runner: {
    entrypoint: 'release/atm-onefile/atm.mjs',
    digest: `sha256:${'3'.repeat(64)}`
  },
  thresholds: {
    starvationThresholdMs: 30000,
    thresholdSource: 'policy',
    minimumParallelOverlapRatio: 0.2,
    maximumSerializedAdmissionRatio: 0.8
  },
  coverage: {
    digest: `sha256:${'4'.repeat(64)}`
  },
  historicalInputs: [{ role: 'compact-digest', source: 'Plan 2.2 BCR/closure mismatch evidence' }],
  failureShapes: [
    {
      role: 'closeback-closure-packet',
      failureClass: 'closure-packet-divergence',
      expectedCounter: 'closurePacketDivergenceCount',
      evidenceRef: 'historical:0014'
    },
    {
      role: 'broker-dimension',
      failureClass: 'dimension-mismatch',
      expectedCounter: 'dimensionMismatchCount',
      evidenceRef: 'historical:0015'
    }
  ]
});

const evaluation = evaluateParallelReplayScenario(scenario);
assert.equal(evaluation.schemaId, 'atm.parallelReplayEvaluation.v1');
assert.equal(evaluation.redBaseline, 'red');
assert.equal(evaluation.counters['closure-packet-divergence'], 1);
assert.equal(evaluation.counters['dimension-mismatch'], 1);
assert.equal(evaluation.counters['stale-current-allowed-task'], 0);
assert.equal(evaluation.scenarioDigest, scenario.digest);

console.log('[atm-3-red-baseline-discrimination] ok');


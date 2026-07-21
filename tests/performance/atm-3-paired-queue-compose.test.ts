import assert from 'node:assert/strict';
import { buildParallelReplayEvidence, buildParallelReplayScenario } from '../../packages/core/src/broker/replay/index.ts';

const scenario = buildParallelReplayScenario({
  scenarioId: 'atm-3-paired-queue-compose',
  generatedAt: '2026-07-21T00:00:00.000Z',
  runner: { entrypoint: 'atm.mjs', digest: `sha256:${'c'.repeat(64)}` },
  thresholds: {
    starvationThresholdMs: 30000,
    thresholdSource: 'paired-baseline-evidence',
    minimumParallelOverlapRatio: 0.3,
    maximumSerializedAdmissionRatio: 0.7
  },
  coverage: { digest: `sha256:${'d'.repeat(64)}` },
  historicalInputs: [{ arm: 'AB' }, { arm: 'BA' }],
  failureShapes: []
});

const evidence = buildParallelReplayEvidence({
  scenario,
  workerReceipts: [
    { workerId: 'ab', actorId: 'ab', processId: 1, startedAtMs: 0, finishedAtMs: 100, runner: scenario.runner, admission: 'parallel', sideEffects: [], exitCode: 0, stdoutDigest: 'sha256:ok', stderrDigest: 'sha256:ok' },
    { workerId: 'ba', actorId: 'ba', processId: 2, startedAtMs: 5, finishedAtMs: 95, runner: scenario.runner, admission: 'parallel', sideEffects: [], exitCode: 0, stdoutDigest: 'sha256:ok', stderrDigest: 'sha256:ok' }
  ],
  serialMakespanMs: 250,
  parallelMakespanMs: 100,
  costRatio: 1.02
});

assert.equal(evidence.verdict, 'pass');
assert.equal(evidence.throughputGainRatio >= 1.25, true);
assert.equal(evidence.costRatio <= 1.1, true);

const missingTimingEvidence = buildParallelReplayEvidence({
  scenario,
  workerReceipts: evidence.workerReceipts
});
assert.equal(missingTimingEvidence.throughputGainRatio, 0);
assert.equal(missingTimingEvidence.verdict, 'inconclusive');

console.log('[atm-3-paired-queue-compose.test] ok');

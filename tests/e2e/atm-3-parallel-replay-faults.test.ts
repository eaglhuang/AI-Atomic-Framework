import assert from 'node:assert/strict';
import { buildParallelReplayEvidence, buildParallelReplayScenario } from '../../packages/core/src/broker/replay/index.ts';

const scenario = buildParallelReplayScenario({
  scenarioId: 'atm-3-fault-injection',
  generatedAt: '2026-07-21T00:00:00.000Z',
  runner: { entrypoint: 'atm.mjs', digest: `sha256:${'a'.repeat(64)}` },
  thresholds: {
    starvationThresholdMs: 30000,
    thresholdSource: 'policy',
    minimumParallelOverlapRatio: 0.3,
    maximumSerializedAdmissionRatio: 0.7
  },
  coverage: { digest: `sha256:${'b'.repeat(64)}` },
  historicalInputs: [],
  failureShapes: []
});
const evidence = buildParallelReplayEvidence({
  scenario,
  workerReceipts: [
    { workerId: 'a', actorId: 'a', processId: 1, startedAtMs: 0, finishedAtMs: 100, runner: scenario.runner, admission: 'parallel', sideEffects: [], exitCode: 0, stdoutDigest: 'sha256:ok', stderrDigest: 'sha256:ok' },
    { workerId: 'b', actorId: 'b', processId: 2, startedAtMs: 10, finishedAtMs: 110, runner: scenario.runner, admission: 'parallel', sideEffects: [], exitCode: 0, stdoutDigest: 'sha256:ok', stderrDigest: 'sha256:ok' }
  ],
  faultCounters: { duplicateSideEffectCount: 1 }
});

assert.equal(evidence.verdict, 'queue-only');
assert.equal(evidence.faultCounters.duplicateSideEffectCount, 1);
assert.equal(evidence.timeInQueueOnlyRatio, 0);

console.log('[atm-3-parallel-replay-faults.test] ok');

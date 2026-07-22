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
  workerReceipts: pairedReceipts(),
  serialMakespanMs: 250,
  parallelMakespanMs: 100,
  costRatio: 1.02
});

assert.equal(evidence.verdict, 'pass');
assert.equal(evidence.throughputGainRatio >= 1.25, true);
assert.equal(evidence.costRatio <= 1.1, true);
assert.equal(evidence.workerReceipts.length, 6);
assert.equal(evidence.workerReceipts.every((worker) => (worker.commandReceipts?.length ?? 0) >= 1), true);
assert.equal(new Set(evidence.workerReceipts.map((worker) => worker.sideEffects.find((effect) => effect.startsWith('paired-arm:')))).size, 2);

const missingTimingEvidence = buildParallelReplayEvidence({
  scenario,
  workerReceipts: evidence.workerReceipts
});
assert.equal(missingTimingEvidence.throughputGainRatio, 0);
assert.equal(missingTimingEvidence.verdict, 'inconclusive');

console.log('[atm-3-paired-queue-compose.test] ok');

function pairedReceipts() {
  return Array.from({ length: 3 }, (_, repeat) => [
    pairedReceipt(`ab-${repeat + 1}`, 'AB', repeat * 5, repeat * 5 + 100),
    pairedReceipt(`ba-${repeat + 1}`, 'BA', repeat * 5 + 5, repeat * 5 + 95)
  ]).flat();
}

function pairedReceipt(workerId: string, arm: 'AB' | 'BA', startedAtMs: number, finishedAtMs: number) {
  return {
    workerId,
    actorId: workerId,
    processId: Number.parseInt(workerId.replace(/\D/g, ''), 10),
    startedAtMs,
    finishedAtMs,
    runner: scenario.runner,
    admission: 'parallel' as const,
    sideEffects: [`paired-arm:${arm}`, 'policy-cli:queue-only-arm-sealed', 'command-receipt:real-timing'],
    exitCode: 0,
    stdoutDigest: 'sha256:ok',
    stderrDigest: 'sha256:ok',
    commandReceipts: [{
      command: `node atm.mjs broker replay paired --arm ${arm} --repeat ${workerId} --json`,
      startedAtMs,
      finishedAtMs,
      exitCode: 0,
      stdoutDigest: 'sha256:ok',
      stderrDigest: 'sha256:ok',
      brokerTicketState: 'execute-now',
      waitedMs: 0
    }]
  };
}

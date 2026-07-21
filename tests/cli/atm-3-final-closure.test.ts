import assert from 'node:assert/strict';
import { buildAtm3FinalClosureVerdictFromEvidence } from '../../packages/cli/src/commands/broker/parallel-admission/final-verdict.ts';
import { buildParallelReplayEvidence, buildParallelReplayScenario } from '../../packages/core/src/broker/replay/index.ts';

const scenario = buildParallelReplayScenario({
  scenarioId: 'atm-3-final-closure',
  generatedAt: '2026-07-21T00:00:00.000Z',
  runner: { entrypoint: 'atm.mjs', digest: `sha256:${'a'.repeat(64)}` },
  thresholds: {
    starvationThresholdMs: 30000,
    thresholdSource: 'paired-baseline-evidence',
    minimumParallelOverlapRatio: 0.3,
    maximumSerializedAdmissionRatio: 0.7
  },
  coverage: { digest: `sha256:${'b'.repeat(64)}` },
  historicalInputs: [{ arm: 'AB' }, { arm: 'BA' }],
  failureShapes: []
});

const replayEvidence = buildParallelReplayEvidence({
  scenario,
  workerReceipts: [
    {
      workerId: 'a',
      actorId: 'a',
      processId: 1,
      startedAtMs: 0,
      finishedAtMs: 100,
      runner: scenario.runner,
      admission: 'parallel',
      sideEffects: ['broker-decision:execute-now'],
      exitCode: 0,
      stdoutDigest: 'sha256:ok',
      stderrDigest: 'sha256:ok',
      commandReceipts: commandReceipts('a', 0, 100, 210)
    },
    {
      workerId: 'b',
      actorId: 'b',
      processId: 2,
      startedAtMs: 5,
      finishedAtMs: 95,
      runner: scenario.runner,
      admission: 'parallel',
      sideEffects: ['broker-decision:execute-now'],
      exitCode: 0,
      stdoutDigest: 'sha256:ok',
      stderrDigest: 'sha256:ok',
      commandReceipts: commandReceipts('b', 5, 95, 210)
    }
  ],
  serialMakespanMs: 250,
  parallelMakespanMs: 100,
  costRatio: 1.02
});

const verdict = buildAtm3FinalClosureVerdictFromEvidence({
  actorId: 'tester',
  replayEvidence,
  inheritedAcceptanceOpenCount: 0,
  blockerBacklogIds: [],
  readinessProbeFailures: [],
  realTaskDogfoodIntersection: ['docs/governance/atm-3-replay-evidence.md'],
  rollbackExercised: true,
  sourceFrozenReleaseParity: true,
  now: '2026-07-21T00:00:00.000Z'
});

assert.equal(verdict.schemaId, 'atm.atm3FinalClosureVerdict.v1');
assert.equal(verdict.decision, 'close');
assert.equal(verdict.circuitBreakerAction, 'reset-with-digest');
assert.equal(verdict.blockers.length, 0);
assert.match(verdict.evidenceDigest, /^sha256:[a-f0-9]{64}$/);
assert.equal(verdict.policyAfterDecision.tripped, false);
assert.equal(verdict.policyAfterDecision.resetEvidenceDigest, verdict.evidenceDigest);

const noReceiptEvidence = buildParallelReplayEvidence({
  scenario,
  workerReceipts: replayEvidence.workerReceipts.map(({ commandReceipts: _commandReceipts, ...worker }) => worker),
  serialMakespanMs: 250,
  parallelMakespanMs: 100,
  costRatio: 1.02
});
const noReceiptVerdict = buildAtm3FinalClosureVerdictFromEvidence({
  actorId: 'tester',
  replayEvidence: noReceiptEvidence,
  inheritedAcceptanceOpenCount: 0,
  blockerBacklogIds: [],
  readinessProbeFailures: [],
  realTaskDogfoodIntersection: ['docs/governance/atm-3-replay-evidence.md'],
  rollbackExercised: true,
  sourceFrozenReleaseParity: true
});
assert.equal(noReceiptVerdict.decision, 'remain-open');
assert.equal(noReceiptVerdict.blockers.some((entry) => entry.includes('real multiprocess replay evidence missing')), true);

console.log('atm 3 final closure verdict ok');

function commandReceipts(workerId: string, startedAtMs: number, finishedAtMs: number, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    command: `node atm.mjs broker decision --intent-file ${workerId}-${index}.json --json`,
    startedAtMs,
    finishedAtMs,
    exitCode: 0,
    stdoutDigest: 'sha256:ok',
    stderrDigest: 'sha256:ok',
    brokerTicketState: 'execute-now',
    waitedMs: 0
  }));
}

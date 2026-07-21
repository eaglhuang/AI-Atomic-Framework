import assert from 'node:assert/strict';
import { runFrozenParallelReplay } from '../../packages/cli/src/commands/broker/replay/implementation.ts';
import { buildParallelReplayTelemetryProof } from '../../packages/core/src/telemetry/parallel-replay/index.ts';

const evidence = await runFrozenParallelReplay({ cwd: process.cwd(), workerCount: 3 });
const proof = buildParallelReplayTelemetryProof(evidence);

assert.equal(evidence.schemaId, 'atm.parallelReplayEvidence.v1');
assert.equal(evidence.verdict, 'pass');
assert.equal(evidence.workerReceipts.every((worker) => worker.runner.entrypoint === 'atm.mjs'), true);
assert.equal(evidence.workerReceipts.every((worker) => worker.exitCode === 0), true);
assert.equal(evidence.maxConcurrentWorkers >= 2, true);
assert.equal(evidence.overlapWindowMs > 0, true);
assert.equal(evidence.parallelAdmissionCount > 0, true);
assert.equal(evidence.parallelOverlapRatio >= 0.3, true);
assert.equal(evidence.serializedAdmissionRatio <= 0.7, true);
assert.match(evidence.digest, /^sha256:[a-f0-9]{64}$/);
assert.equal(proof.correctness.escapedConflictCount, 0);
assert.equal(proof.breaker.timeInQueueOnlyRatio, 0);

console.log('[atm-3-real-parallel-replay.test] ok');

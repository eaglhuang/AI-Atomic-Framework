import { strict as assert } from 'node:assert';
import { buildBatchTeamIntegrationReport } from '../../packages/cli/src/commands/batch.ts';
import { evaluateBatchTeamAdmission } from '../../packages/cli/src/commands/team.ts';

const admitted = evaluateBatchTeamAdmission({
  taskId: 'ATM-GOV-0141',
  batchId: 'batch-1',
  currentQueueHeadTaskId: 'ATM-GOV-0141',
  structuralParallelism: true,
  costTelemetryLoaded: true
});

assert.equal(admitted.allowed, true);
assert.equal(admitted.mode, 'team-current-head');
assert.deepEqual(admitted.reasonCodes, []);
assert.equal(admitted.queueHeadOnly, true);
assert.equal(admitted.structuralParallelismRequired, true);

const refused = evaluateBatchTeamAdmission({
  taskId: 'ATM-GOV-0142',
  batchId: 'batch-1',
  currentQueueHeadTaskId: 'ATM-GOV-0141',
  structuralParallelism: false,
  costTelemetryLoaded: false,
  stopLossTriggered: true
});

assert.equal(refused.allowed, false);
assert.equal(refused.mode, 'single-agent');
assert.deepEqual(refused.reasonCodes, [
  'not-current-queue-head',
  'no-structural-parallelism',
  'missing-cost-telemetry',
  'stop-loss-triggered'
]);
assert.equal(refused.stopLossAction, 'single-agent');

const report = buildBatchTeamIntegrationReport({
  taskId: 'ATM-GOV-0141',
  batchId: 'batch-1',
  currentQueueHeadTaskId: 'ATM-GOV-0141',
  structuralParallelism: true,
  evidencePayloadDigest: 'sha256:abc',
  sealedPayloadDigest: 'sha256:abc',
  queueHeadLatencyMs: 900,
  batchMakespanMs: 30000,
  completedTaskCount: 3,
  attempts: [
    { inputTokens: 100, outputTokens: 40, cacheReadTokens: 10, fullyLoadedCostUsd: 0.12 },
    { inputTokens: 25, outputTokens: 15, fullyLoadedCostUsd: 0.03, retry: true },
    { inputTokens: 5, outputTokens: 2, fullyLoadedCostUsd: 0.01, discarded: true }
  ]
});

assert.equal(report.sealedClose.usesSealAndCommitTransaction, true);
assert.equal(report.sealedClose.checkpointRefusesPayloadMismatch, true);
assert.equal(report.sealedClose.payloadDigestMatchesEvidence, true);
assert.equal(report.teamAdmission.allowed, true);
assert.equal(report.usage.attemptCount, 3);
assert.equal(report.usage.retryCount, 1);
assert.equal(report.usage.discardedContributionCount, 1);
assert.equal(report.usage.inputTokens, 130);
assert.equal(report.usage.outputTokens, 57);
assert.equal(report.usage.cacheReadTokens, 10);
assert.equal(report.usage.fullyLoadedCostUsd, 0.16);
assert.equal(report.latency.queueHeadLatencyMs, 900);
assert.equal(report.latency.batchMakespanMs, 30000);
assert.equal(report.latency.throughputPerMinute, 6);
assert.equal(report.latency.throughputIsSingleTaskLatency, false);
assert.equal(report.stopLoss.closeSemanticsChanged, false);

const mismatch = buildBatchTeamIntegrationReport({
  taskId: 'ATM-GOV-0141',
  batchId: 'batch-1',
  currentQueueHeadTaskId: 'ATM-GOV-0141',
  structuralParallelism: true,
  evidencePayloadDigest: 'sha256:old',
  sealedPayloadDigest: 'sha256:new',
  queueHeadLatencyMs: 100,
  batchMakespanMs: 1000,
  completedTaskCount: 1,
  costTelemetryLoaded: true
});

assert.equal(mismatch.sealedClose.payloadDigestMatchesEvidence, false);

const stopLoss = buildBatchTeamIntegrationReport({
  taskId: 'ATM-GOV-0141',
  batchId: 'batch-1',
  currentQueueHeadTaskId: 'ATM-GOV-0141',
  structuralParallelism: true,
  evidencePayloadDigest: 'sha256:abc',
  sealedPayloadDigest: 'sha256:abc',
  queueHeadLatencyMs: 100,
  batchMakespanMs: 1000,
  completedTaskCount: 1,
  costTelemetryLoaded: true,
  stopLossTriggered: true
});

assert.equal(stopLoss.stopLoss.triggered, true);
assert.equal(stopLoss.stopLoss.laterQueueHeadRoute, 'single-agent');
assert.equal(stopLoss.stopLoss.closeSemanticsChanged, false);
assert.equal(stopLoss.teamAdmission.allowed, false);

console.log('[batch-team-integration] ok');

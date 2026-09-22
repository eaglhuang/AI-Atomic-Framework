import assert from 'node:assert/strict';
import { calculateAdjudicationRates } from '../../scripts/lib/external-benchmark/adjudication.ts';
import { aggregateRawRuns, applyTotalCostPolicy, rawRunFromExecutionEvidence, type RawBenchmarkRun } from '../../scripts/lib/external-benchmark/metrics.ts';
import { decideBenchmark } from '../../scripts/lib/external-benchmark/report.ts';

const runs: RawBenchmarkRun[] = Array.from({ length: 10 }, (_, i) => ({ runId: `run-${i}`, roundId: `pair-${i % 5}`, sequence: i % 2 ? 'BA' : 'AB', arm: 'atm', repository: 'r', commitSha: 'a'.repeat(40), startedAt: '2026-01-01T00:00:00Z', finishedAt: '2026-01-01T00:00:01Z', prompt: 'p', tokens: 10, billedCost: 1, humanMinutes: i === 9 ? null : 6, retries: 0, commands: ['x'], repairs: [], environmentDigest: 'sha256:x', completion: true, repairTimeMs: 0 }));
const records = Array.from({ length: 10 }, (_, i) => ({ runId: `run-${i}`, adjudicator: 'j', hiddenCorpusOwner: 'c', implementer: 'i', arm: 'atm' as const, falseBlock: false, missedConflict: false, completed: true, truth: i === 9 ? 'conflict' as const : 'benign' as const, decision: i === 0 ? 'blocked' as const : i === 9 ? 'allowed' as const : 'allowed' as const }));
const rates = calculateAdjudicationRates(records, 'atm');
assert.equal(rates.falseBlockDenominator, 9); assert.equal(rates.missedConflictDenominator, 1); assert.equal(rates.falseBlockCount, 1); assert.equal(rates.missedConflictCount, 1); assert.equal(rates.unavailableCount, 0);
assert(Number.isNaN(calculateAdjudicationRates([{ ...records[0], truth: 'unknown', decision: 'unknown' }], 'atm').falseBlockRate));
const aggregate = aggregateRawRuns(runs, 'atm'); assert.equal(aggregate.humanMinutes, null); assert.equal(applyTotalCostPolicy(aggregate, runs, { humanRatePerHour: 60 }).totalCost, null);
const completeRuns = runs.map(run => ({ ...run, humanMinutes: 6 })); const total = applyTotalCostPolicy(aggregateRawRuns(completeRuns, 'atm'), completeRuns, { humanRatePerHour: 60, computeCostByRun: new Map(completeRuns.map(run => [run.runId, 0.1])) }); assert.equal(total.totalCost, 71);
const safe = { falseBlockRate: 0, missedConflictRate: 0, completionRate: 1, falseBlockDenominator: 10, missedConflictDenominator: 10 };
assert.equal(decideBenchmark({ eligible: true, blockingReasons: [], rounds: ['AB', 'BA'], baseline: { ...total, arm: 'baseline', billedCost: 100, totalCost: 200, completionRate: 1 }, atm: { ...total, totalCost: 150, completionRate: 1 }, baselineSafety: safe, atmSafety: safe, costPolicy: 'total', minimumCompletionRate: .9 }).verdict, 'keep');
assert.equal(decideBenchmark({ eligible: true, blockingReasons: [], rounds: ['AB', 'BA'], baseline: { ...total, arm: 'baseline', billedCost: 100, totalCost: 200, completionRate: .5 }, atm: { ...total, totalCost: 150, completionRate: 1 }, baselineSafety: safe, atmSafety: safe, costPolicy: 'total', minimumCompletionRate: .9 }).verdict, 'stop');
const adapted = rawRunFromExecutionEvidence({
  schemaId: 'atm.benchmarkArmRawEvidence.v1', pairId: 'pair', arm: 'atm', repositoryUrl: 'repo', commitSha: 'a'.repeat(40),
  startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z', wallClockMs: 1000,
  provider: 'provider', model: 'model', reasoning: 'default', packageVersion: '0.1.2', promptDigest: `sha256:${'a'.repeat(64)}`,
  tokens: 10, costUsd: 1, command: 'run',
  telemetry: { completion: 'completed', completionEvidence: 'oracle:run-1', humanMinutes: 2, humanIntervals: null, retries: 0, repairTimeMs: 4, repairTimestamps: null, unavailableReasons: [] }
}, { runId: 'run-1', roundId: 'pair', sequence: 'AB', prompt: 'p', environmentDigest: 'sha256:x' });
assert.equal(adapted.completion, true); assert.equal(adapted.repairTimeMs, 4); assert.equal(adapted.retries, 0);
const unaudited = rawRunFromExecutionEvidence({
  schemaId: 'atm.benchmarkArmRawEvidence.v1', pairId: 'pair', arm: 'atm', repositoryUrl: 'repo', commitSha: 'a'.repeat(40),
  startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:00:01Z', wallClockMs: 1000,
  provider: 'provider', model: 'model', reasoning: 'default', packageVersion: null, promptDigest: `sha256:${'a'.repeat(64)}`,
  tokens: 10, costUsd: 1, command: 'run',
  telemetry: { completion: 'completed', completionEvidence: null, humanMinutes: null, humanIntervals: null, retries: null, repairTimeMs: null, repairTimestamps: null, unavailableReasons: ['no-oracle'] }
}, { runId: 'run-2', roundId: 'pair', sequence: 'AB', prompt: 'p', environmentDigest: 'sha256:x' });
assert.equal(unaudited.completion, null); assert.equal(unaudited.repairTimeMs, null); assert.equal(unaudited.retries, null);
console.log('external-benchmark-v2-metrics ok');

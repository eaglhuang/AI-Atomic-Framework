import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const cwd = process.cwd();
const reportPath = join(mkdtempSync(join(tmpdir(), 'atm-0190-')), 'report.md');
const result = spawnSync(process.execPath, [
  '--strip-types',
  'scripts/analyze-captain-parallel-ledger.ts',
  '--event-root',
  'scripts/fixtures/auto-batch-analyzer/task-events',
  '--session-event-root',
  'scripts/fixtures/auto-batch-analyzer/session-events',
  '--lock-root',
  'scripts/fixtures/auto-batch-analyzer/locks',
  '--coverage-report',
  'scripts/fixtures/auto-batch-analyzer/coverage-ready.json',
  '--report',
  reportPath
], { cwd, encoding: 'utf8' });

assert.equal(result.status, 0, result.stderr);
const analysis = JSON.parse(result.stdout);

assert.equal(analysis.schemaId, 'atm.captainParallelLedgerAnalysis.v1');
assert.equal(analysis.planPerformanceReport.schemaId, 'atm.planPerformanceReport.v1');
assert.equal(analysis.planPerformanceReport.version, 'v3');
assert.equal(analysis.planPerformanceReport.analyzerRole, 'm2');
assert.ok(analysis.planPerformanceReport.matchedCohorts.pairCount >= 1, 'the analyzer needs at least one matched pair');
assert.ok(Number.isInteger(analysis.planPerformanceReport.brokerDecisionAnalysis.correctnessSampleCount));
// A verdict is a conclusion about live evidence, so it must not be pinned:
// asserting "improved" here would claim a benefit the data may not support.
// What must hold is that every verdict is a known value, that the dimensions
// agree with the overall verdict, and that the Markdown says what the JSON says.
const report = analysis.planPerformanceReport;
const verdicts = ['improved', 'inconclusive', 'regressed'];
const dimensionVerdicts = [
  report.brokerDecisionAnalysis.verdict,
  report.gateEffectiveness.historicalReplay.verdict,
  report.gateEffectiveness.shadowMode.verdict,
  report.gateEffectiveness.canonicalParity.verdict,
  report.gateEffectiveness.matchedBatchAb.verdict,
  report.telemetrySelfGovernance.verdict
];
for (const verdict of [...dimensionVerdicts, report.rolloutVerdict.overall]) {
  assert.ok(verdicts.includes(verdict), `unexpected verdict ${verdict}`);
}
if (report.rolloutVerdict.overall === 'improved') {
  assert.deepEqual([...new Set(dimensionVerdicts)], ['improved'], 'an improved rollout cannot rest on a dimension that is not improved');
  assert.deepEqual(report.coverageLimitations, [], 'an improved rollout cannot carry coverage limitations');
}
assert.equal(report.brokerDecisionAnalysis.escapedConflictCount, 0, 'an escaped conflict is never acceptable');
assert.ok(Array.isArray(report.coverageLimitations));

const markdown = readFileSync(reportPath, 'utf8');
assert.match(markdown, /Plan Performance Report v3/);
assert.match(markdown, new RegExp(`Broker correctness: tickets=${report.brokerDecisionAnalysis.correctnessSampleCount}`));
assert.match(markdown, new RegExp(`overall=${report.rolloutVerdict.overall}`), 'the rendered report must carry the same overall verdict as the JSON');

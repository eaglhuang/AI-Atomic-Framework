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
assert.equal(analysis.planPerformanceReport.matchedCohorts.pairCount, 1);
assert.equal(analysis.planPerformanceReport.brokerDecisionAnalysis.correctnessSampleCount, 4);
assert.equal(analysis.planPerformanceReport.brokerDecisionAnalysis.verdict, 'improved');
assert.equal(analysis.planPerformanceReport.brokerDecisionAnalysis.escapedConflictCount, 0);
assert.equal(analysis.planPerformanceReport.brokerDecisionAnalysis.composeAcceptanceRate, 1);
assert.equal(analysis.planPerformanceReport.gateEffectiveness.historicalReplay.verdict, 'improved');
assert.equal(analysis.planPerformanceReport.gateEffectiveness.shadowMode.verdict, 'improved');
assert.equal(analysis.planPerformanceReport.gateEffectiveness.canonicalParity.verdict, 'improved');
assert.equal(analysis.planPerformanceReport.gateEffectiveness.matchedBatchAb.verdict, 'improved');
assert.equal(analysis.planPerformanceReport.telemetrySelfGovernance.verdict, 'improved');
assert.equal(analysis.planPerformanceReport.rolloutVerdict.overall, 'improved');
assert.deepEqual(analysis.planPerformanceReport.coverageLimitations, []);

const markdown = readFileSync(reportPath, 'utf8');
assert.match(markdown, /Plan Performance Report v3/);
assert.match(markdown, /Broker correctness: tickets=4/);
assert.match(markdown, /Rollout verdict: speed=improved, cost=improved, safety=improved, observability=improved, overall=improved/);

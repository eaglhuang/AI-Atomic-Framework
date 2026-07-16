import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, [
  '--strip-types',
  'scripts/analyze-captain-parallel-ledger.ts'
], {
  cwd: process.cwd(),
  encoding: 'utf8'
});

assert.equal(result.status, 0, result.stderr);
const report = JSON.parse(result.stdout);
assert.equal(report.schemaId, 'atm.captainParallelLedgerAnalysis.v1');

const serial = report.waves.find((wave: { label: string }) => wave.label === 'serial-baseline-rft-0020-0025');
const parallel = report.waves.find((wave: { label: string }) => wave.label === 'parallel-wave-rft-0030-0082');
assert.ok(serial, 'serial baseline wave exists');
assert.ok(parallel, 'parallel RFT wave exists');

assert.equal(serial.taskCount, 6);
assert.ok(parallel.taskCount >= 40, 'parallel wave has a substantial real ledger sample');
assert.ok(parallel.actorCount >= 2, 'parallel wave includes multiple actors');
assert.ok(parallel.maxConcurrency >= 1, 'parallel wave has claim windows');
assert.ok(parallel.overlapRatio >= 0, 'parallel wave overlap ratio is measured');
assert.ok(parallel.activeWindowMs > 0, 'parallel wave active window is measured');
assert.ok(parallel.throughputTasksPerActiveHour > 0, 'parallel wave active-time throughput is measured');
assert.equal(parallel.repairClosureCount, 0);
assert.ok(serial.repairClosureCount > parallel.repairClosureCount);
assert.equal(typeof report.comparison.throughputRatio, 'number');
assert.equal(typeof report.comparison.activeTimeThroughputRatio, 'number');
assert.equal(report.runtimeFrameworkLockSnapshot.caveat.includes('runtime snapshot'), true);
assert.ok(report.observabilityGaps.some((gap: { lane: string; status: string }) => gap.lane === 'framework-mode temp claims' && gap.status === 'snapshot-only'));
assert.ok(report.observabilityGaps.some((gap: { lane: string; status: string }) => gap.lane === 'cross-repository planning or implementation' && gap.status === 'not-observable-from-this-ledger'));

console.log('[captain-parallel-ledger-analysis] ok');

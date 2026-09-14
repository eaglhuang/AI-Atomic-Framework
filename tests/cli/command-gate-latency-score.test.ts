import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  buildCommandGateLatencyMarkdown,
  buildCommandGateLatencyReport,
  buildCommandGateLatencyReportFromEvents,
  compareCommandGateLatencyReports,
  unionIntervalsMs,
  validateCommandGateLatencyReport,
  type CommandGateLatencyInventoryEntry,
  type CommandGateLatencySample
} from '../../scripts/plan-performance-report-v4.ts';

const inventory: readonly CommandGateLatencyInventoryEntry[] = [
  { key: 'next.route', command: 'next', gate: 'route', mandatory: true, applicability: 'every task' },
  { key: 'doctor.integrity', command: 'doctor', gate: 'integrity', mandatory: true, applicability: 'release and repair' },
  { key: 'quickfix.apply', command: 'quickfix', gate: 'apply', mandatory: true, applicability: 'fixed bug lane' },
  { key: 'telemetry.report', command: 'telemetry', gate: 'report', mandatory: false, applicability: 'measurement only' }
];

const samples: readonly CommandGateLatencySample[] = [
  {
    sampleId: 'next-1', key: 'next.route', command: 'next', gate: 'route', mandatory: true,
    applicability: 'every task', durationMs: 100, outcome: 'pass', frequency: 100
  },
  {
    sampleId: 'doctor-1', key: 'doctor.integrity', command: 'doctor', gate: 'integrity', mandatory: true,
    applicability: 'release and repair', durationMs: 5000, outcome: 'pass',
    spans: [
      { spanId: 'doctor-root', startMs: 0, endMs: 5000, phase: 'execution' },
      { spanId: 'doctor-io', startMs: 1000, endMs: 2000, parentSpanId: 'doctor-root', phase: 'io' },
      { spanId: 'doctor-queue', startMs: 500, endMs: 1500, parentSpanId: 'doctor-root', phase: 'queue' }
    ],
    taskInterval: { startMs: 100, endMs: 5100 }, evidenceRef: 'sink://doctor-1'
  },
  {
    sampleId: 'quickfix-1', key: 'quickfix.apply', command: 'quickfix', gate: 'apply', mandatory: true,
    applicability: 'fixed bug lane', durationMs: 50, outcome: 'fail', frequency: 2
  }
];

assert.equal(unionIntervalsMs([{ startMs: 0, endMs: 10 }, { startMs: 2, endMs: 8 }, { startMs: 9, endMs: 20 }]), 20);

const report = buildCommandGateLatencyReport({ inventory, samples, generatedAt: '2026-09-15T00:00:00.000Z', measurementOverheadMs: 2 });
assert.deepEqual(validateCommandGateLatencyReport(report), []);
assert.equal(report.coveragePct, 75);
assert.deepEqual(report.uncoveredKeys, ['telemetry.report']);
assert.equal(report.scores.find((score) => score.key === 'doctor.integrity')?.inclusiveMs, 5000);
assert.equal(report.scores.find((score) => score.key === 'doctor.integrity')?.exclusiveMs, 3500);
assert.equal(report.scores.find((score) => score.key === 'next.route')?.cumulativeTaskWaitingMs, 10000);
assert.equal(report.hotspots[0]?.key, 'next.route', 'frequency-weighted cost must outrank a rare slow command');
assert.match(buildCommandGateLatencyMarkdown(report), /Unknown values mean no real sample was available/);

const projected = buildCommandGateLatencyReportFromEvents({
  inventory,
  mandatoryKeys: ['next.route'],
  events: [{
    eventId: 'event-1', checkId: 'next.route', gate: 'next', command: 'node atm.mjs next',
    durationMs: 125, result: 'pass', taskId: 'TASK-1', runId: 'run-1'
  }]
});
assert.equal(projected.observedCount, 1);
assert.equal(projected.scores.find((score) => score.key === 'next.route')?.p50Ms, 125);
assert.equal(projected.scores.find((score) => score.key === 'next.route')?.mandatory, true);

assert.throws(() => buildCommandGateLatencyReport({
  inventory,
  samples: [{ ...samples[0], durationMs: -1 }]
}), /sample\.durationMs/);

const baseline = buildCommandGateLatencyReport({
  inventory: [{ key: 'fixed', command: 'fixed', gate: 'mandatory', mandatory: true, applicability: 'fixed' }],
  samples: [
    { sampleId: 'b1', key: 'fixed', command: 'fixed', gate: 'mandatory', mandatory: true, applicability: 'fixed', durationMs: 1000, outcome: 'pass' },
    { sampleId: 'b2', key: 'fixed', command: 'fixed', gate: 'mandatory', mandatory: true, applicability: 'fixed', durationMs: 1100, outcome: 'pass' }
  ]
});
const candidate = buildCommandGateLatencyReport({
  inventory: [{ key: 'fixed', command: 'fixed', gate: 'mandatory', mandatory: true, applicability: 'fixed' }],
  samples: [
    { sampleId: 'c1', key: 'fixed', command: 'fixed', gate: 'mandatory', mandatory: true, applicability: 'fixed', durationMs: 700, outcome: 'pass' },
    { sampleId: 'c2', key: 'fixed', command: 'fixed', gate: 'mandatory', mandatory: true, applicability: 'fixed', durationMs: 800, outcome: 'pass' }
  ]
});
const comparison = compareCommandGateLatencyReports(baseline, candidate);
assert.equal(comparison.verdict, 'pass');
assert.ok((comparison.mandatoryWaitingP50ReductionPct ?? 0) >= 20);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtimeRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-latency-cli-report-'));
try {
  const emit = spawnSync(process.execPath, ['--strip-types', path.join(root, 'packages', 'cli', 'src', 'atm.ts'), 'telemetry', '--cwd', runtimeRepo, '--emit-fixture', '--check-id', 'next.route-resolution', '--duration-ms', '13', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(emit.status, 0, emit.stderr || emit.stdout);
  const cliReport = spawnSync(process.execPath, ['--strip-types', path.join(root, 'packages', 'cli', 'src', 'atm.ts'), 'telemetry', '--cwd', runtimeRepo, '--report', '--include-runtime', '--json'], { cwd: root, encoding: 'utf8' });
  assert.equal(cliReport.status, 0, cliReport.stderr || cliReport.stdout);
  const cliReportJson = JSON.parse(cliReport.stdout);
  assert.equal(cliReportJson.evidence.latencyScore.observedCount, 1);
  assert.equal(cliReportJson.evidence.latencyScore.scores.find((score: { key: string }) => score.key === 'next.route-resolution').p50Ms, 13);
  assert.match(cliReportJson.evidence.latencyMarkdown, /Unknown values mean no real sample was available/);
} finally {
  rmSync(runtimeRepo, { recursive: true, force: true });
}

console.log('ok - command/gate latency score assertions passed (8 assertions plus negative controls)');

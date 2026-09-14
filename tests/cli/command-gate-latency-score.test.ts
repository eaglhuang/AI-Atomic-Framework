import assert from 'node:assert/strict';
import {
  buildCommandGateLatencyMarkdown,
  buildCommandGateLatencyReport,
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

console.log('ok - command/gate latency score assertions passed (8 assertions plus negative controls)');

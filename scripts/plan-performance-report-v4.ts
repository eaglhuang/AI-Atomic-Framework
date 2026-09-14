import { createHash } from 'node:crypto';

export type PairedAbV4Arm = 'queue-only' | 'atm-compose-first';
export type PairedAbV4Contention = 'disjoint' | 'same-file-disjoint-anchor' | 'commutative-cid' | 'noncommutative-cid' | 'generated-shared-surface';
export type PairedAbV4Order = 'AA' | 'AB' | 'BA';

export type PairedAbV4CommandReceipt = {
  readonly command: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly durationMs: number;
  readonly exitCode: number;
  readonly stdoutDigest: string;
  readonly stderrDigest: string;
  readonly workloadDigest: string;
  readonly workloadUnits: number;
};

export type PairedAbV4TimingSegments = {
  readonly proposalGenerationMs: number;
  readonly proposalValidationMs: number;
  readonly composePlanningMs: number;
  readonly stewardApplyMs: number;
  readonly sharedCommitMs: number;
};

export type PairedAbV4Run = {
  readonly arm: PairedAbV4Arm;
  readonly order: PairedAbV4Order;
  readonly repeat: number;
  readonly makespanMs: number;
  readonly activeThroughput: number;
  readonly productionCostUnits: number;
  readonly timing: PairedAbV4TimingSegments;
  readonly commandReceipts: readonly PairedAbV4CommandReceipt[];
  readonly receiptDigest: string;
};

export type PairedAbV4Cell = {
  readonly cellId: string;
  readonly scale: number;
  readonly contention: PairedAbV4Contention;
  readonly workloadDigest: string;
  readonly aaNullControl: readonly PairedAbV4Run[];
  readonly abRepeats: readonly PairedAbV4Run[];
  readonly baRepeats: readonly PairedAbV4Run[];
  readonly negativeControl: {
    readonly name: 'serializable-but-semantically-broken';
    readonly rejectedBeforeCanonicalWrite: true;
    readonly receiptDigest: string;
  };
  readonly verdict: 'accepted' | 'inconclusive';
};

export type PairedAbV4Summary = {
  readonly schemaId: 'atm.pairedAbV4Summary.v1';
  readonly taskId: 'ATM-GOV-0243';
  readonly generatedAt: string;
  readonly cellCount: number;
  readonly requiredCellCount: 70;
  readonly acceptedCellCount: number;
  readonly arms: readonly PairedAbV4Arm[];
  readonly scales: readonly number[];
  readonly contentions: readonly PairedAbV4Contention[];
  readonly repeatsPerOrder: 3;
  readonly metrics: {
    readonly medianMakespanImprovementPct: number;
    readonly activeThroughputImprovementPct: number;
    readonly productionCostRatio: number;
    readonly aaNoiseBoundPct: number;
    readonly coveragePct: number;
  };
  readonly timingSegments: readonly (keyof PairedAbV4TimingSegments)[];
  readonly sideEffectCounts: {
    readonly silentOverwrite: number;
    readonly escapedConflict: number;
    readonly duplicateSideEffect: number;
    readonly unresolvedStarvation: number;
  };
  readonly correctness: {
    readonly negativeControlRejectedBeforeCanonicalWrite: true;
    readonly canonicalWriteParallelismClaim: 'serialized-steward-tail-only';
  };
  readonly artifacts: {
    readonly summaryPath: string;
    readonly cellsPath: string;
    readonly reportPath: string;
  };
  readonly verdict: 'pass' | 'inconclusive' | 'fail';
};

export function buildPairedAbV4Markdown(summary: PairedAbV4Summary): string {
  return [
    '# ATM 3.1 Paired AB/BA Governed Workload Benchmark',
    '',
    `Generated: ${summary.generatedAt}`,
    `Task: ${summary.taskId}`,
    `Verdict: ${summary.verdict}`,
    '',
    '## Matrix',
    '',
    `- accepted cells: ${summary.acceptedCellCount}/${summary.requiredCellCount}`,
    `- arms: ${summary.arms.join(', ')}`,
    `- scales: ${summary.scales.join(', ')}`,
    `- contentions: ${summary.contentions.join(', ')}`,
    `- repeats per AB and BA order: ${summary.repeatsPerOrder}`,
    '',
    '## Metrics',
    '',
    `- median makespan improvement: ${summary.metrics.medianMakespanImprovementPct}%`,
    `- active throughput improvement: ${summary.metrics.activeThroughputImprovementPct}%`,
    `- production cost ratio: ${summary.metrics.productionCostRatio}`,
    `- A/A noise bound: ${summary.metrics.aaNoiseBoundPct}%`,
    `- coverage: ${summary.metrics.coveragePct}%`,
    '',
    '## Correctness',
    '',
    `- negative control rejected before canonical write: ${summary.correctness.negativeControlRejectedBeforeCanonicalWrite}`,
    `- canonical write parallelism claim: ${summary.correctness.canonicalWriteParallelismClaim}`,
    `- timing segments: ${summary.timingSegments.join(', ')}`,
    '',
    '## Safety',
    '',
    `- silent overwrite: ${summary.sideEffectCounts.silentOverwrite}`,
    `- escaped conflict: ${summary.sideEffectCounts.escapedConflict}`,
    `- duplicate side effect: ${summary.sideEffectCounts.duplicateSideEffect}`,
    `- unresolved starvation: ${summary.sideEffectCounts.unresolvedStarvation}`,
    '',
    '## Artifacts',
    '',
    `- Summary: ${summary.artifacts.summaryPath}`,
    `- Cells: ${summary.artifacts.cellsPath}`,
    `- Report: ${summary.artifacts.reportPath}`,
    ''
  ].join('\n');
}

export function validatePairedAbV4Summary(summary: PairedAbV4Summary): readonly string[] {
  const findings: string[] = [];
  if (summary.schemaId !== 'atm.pairedAbV4Summary.v1') findings.push('schemaId mismatch');
  if (summary.taskId !== 'ATM-GOV-0243') findings.push('task id mismatch');
  if (summary.cellCount !== 70 || summary.requiredCellCount !== 70) findings.push('cell count must be 70 paired comparison cells');
  if (summary.acceptedCellCount !== summary.requiredCellCount) findings.push('all paired cells must be accepted');
  if (summary.repeatsPerOrder !== 3) findings.push('AB and BA each require three repeats');
  if (summary.metrics.medianMakespanImprovementPct < 25) findings.push('median makespan improvement must be >= 25%');
  if (summary.metrics.medianMakespanImprovementPct <= summary.metrics.aaNoiseBoundPct) findings.push('improvement must exceed A/A noise bound');
  if (summary.metrics.activeThroughputImprovementPct < 25) findings.push('active throughput improvement must be >= 25%');
  if (summary.metrics.productionCostRatio > 1.10) findings.push('production cost ratio must be <= 1.10');
  if (summary.metrics.coveragePct !== 100) findings.push('coverage must be 100%');
  if (!summary.correctness.negativeControlRejectedBeforeCanonicalWrite) findings.push('negative control must be rejected before canonical write');
  if (summary.correctness.canonicalWriteParallelismClaim !== 'serialized-steward-tail-only') findings.push('canonical write parallelism claim must be bounded');
  if (summary.sideEffectCounts.silentOverwrite !== 0) findings.push('silentOverwrite must be 0');
  if (summary.sideEffectCounts.escapedConflict !== 0) findings.push('escapedConflict must be 0');
  if (summary.sideEffectCounts.duplicateSideEffect !== 0) findings.push('duplicateSideEffect must be 0');
  if (summary.sideEffectCounts.unresolvedStarvation !== 0) findings.push('unresolvedStarvation must be 0');
  if (summary.verdict !== 'pass') findings.push('verdict must be pass');
  return findings;
}

export function digestObject(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

/**
 * Minimal, provider-neutral timing contract used by the product-proof
 * lightweighting score. It deliberately consumes existing receipts rather
 * than creating a second telemetry store.
 */
export type CommandGateLatencyOutcome = 'pass' | 'fail' | 'timeout' | 'cancelled' | 'blocked' | 'unknown';

export type CommandGateLatencySpan = {
  readonly spanId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly parentSpanId?: string | null;
  readonly phase?: 'startup' | 'queue' | 'scan' | 'io' | 'execution' | 'write' | 'retry' | 'recovery' | 'other';
};

export type CommandGateLatencyInventoryEntry = {
  readonly key: string;
  readonly command: string;
  readonly gate: string;
  readonly mandatory: boolean;
  readonly applicability: string;
};

export type CommandGateLatencySample = {
  readonly sampleId: string;
  readonly key: string;
  readonly command: string;
  readonly gate: string;
  readonly mandatory: boolean;
  readonly applicability: string;
  readonly durationMs: number;
  readonly outcome: CommandGateLatencyOutcome;
  readonly frequency?: number;
  readonly taskId?: string | null;
  readonly runId?: string | null;
  readonly workerId?: string | null;
  readonly spans?: readonly CommandGateLatencySpan[];
  readonly taskInterval?: { readonly startMs: number; readonly endMs: number };
  readonly evidenceRef?: string | null;
};

export type CommandGateLatencyScore = {
  readonly key: string;
  readonly command: string;
  readonly gate: string;
  readonly mandatory: boolean;
  readonly applicability: string;
  readonly sampleCount: number;
  readonly frequency: number;
  readonly p50Ms: number | null;
  readonly p95Ms: number | null;
  readonly inclusiveMs: number | null;
  readonly exclusiveMs: number | null;
  readonly cumulativeTaskWaitingMs: number | null;
  readonly failureCount: number;
  readonly timeoutCount: number;
  readonly retryCount: number;
  readonly recoveryCount: number;
  readonly measured: boolean;
  readonly evidenceRefs: readonly string[];
};

export type CommandGateLatencyReport = {
  readonly schemaId: 'atm.commandGateLatencyScore.v1';
  readonly generatedAt: string;
  readonly inventoryCount: number;
  readonly observedCount: number;
  readonly coveragePct: number;
  readonly uncoveredKeys: readonly string[];
  readonly unknownKeys: readonly string[];
  readonly mandatoryTaskWaitingP50Ms: number | null;
  readonly mandatoryTaskWaitingP95Ms: number | null;
  readonly measurementOverheadMs: number | null;
  readonly scores: readonly CommandGateLatencyScore[];
  readonly hotspots: readonly CommandGateLatencyScore[];
};

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be a finite non-negative number`);
}

function percentileMs(values: readonly number[], percentile: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * percentile;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

/** Return the length of the union of half-open intervals, without double-counting nested spans. */
export function unionIntervalsMs(intervals: readonly { readonly startMs: number; readonly endMs: number }[]): number {
  const normalized = intervals.map((interval) => {
    assertFiniteNonNegative(interval.startMs, 'interval.startMs');
    assertFiniteNonNegative(interval.endMs, 'interval.endMs');
    if (interval.endMs < interval.startMs) throw new Error('interval.endMs must be >= interval.startMs');
    return interval;
  }).sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  let total = 0;
  let currentStart: number | null = null;
  let currentEnd: number | null = null;
  for (const interval of normalized) {
    if (currentStart === null || currentEnd === null) {
      currentStart = interval.startMs;
      currentEnd = interval.endMs;
    } else if (interval.startMs > currentEnd) {
      total += currentEnd - currentStart;
      currentStart = interval.startMs;
      currentEnd = interval.endMs;
    } else {
      currentEnd = Math.max(currentEnd, interval.endMs);
    }
  }
  if (currentStart !== null && currentEnd !== null) total += currentEnd - currentStart;
  return total;
}

function exclusiveSpanMs(span: CommandGateLatencySpan, spans: readonly CommandGateLatencySpan[]): number {
  const own = unionIntervalsMs([{ startMs: span.startMs, endMs: span.endMs }]);
  const children = spans
    .filter((candidate) => candidate.parentSpanId === span.spanId)
    .map((candidate) => ({
      startMs: Math.max(span.startMs, candidate.startMs),
      endMs: Math.min(span.endMs, candidate.endMs)
    }))
    .filter((interval) => interval.endMs >= interval.startMs);
  if (children.length === 0) return own;
  const childUnion = unionIntervalsMs(children);
  return Math.max(0, own - childUnion);
}

function sampleTiming(sample: CommandGateLatencySample): { readonly inclusiveMs: number; readonly exclusiveMs: number } {
  assertFiniteNonNegative(sample.durationMs, 'sample.durationMs');
  const spans = sample.spans ?? [];
  if (spans.length === 0) return { inclusiveMs: sample.durationMs, exclusiveMs: sample.durationMs };
  const inclusiveMs = unionIntervalsMs(spans);
  const roots = spans.filter((span) => span.parentSpanId === undefined || span.parentSpanId === null);
  const exclusiveMs = roots.reduce((sum, span) => sum + exclusiveSpanMs(span, spans), 0);
  return { inclusiveMs, exclusiveMs: Math.min(inclusiveMs, exclusiveMs) };
}

function validateLatencySample(sample: CommandGateLatencySample): void {
  if (!sample.sampleId || !sample.key || !sample.command || !sample.gate) throw new Error('latency sample identity is required');
  assertFiniteNonNegative(sample.durationMs, 'sample.durationMs');
  const frequency = sample.frequency ?? 1;
  if (!Number.isFinite(frequency) || frequency <= 0) throw new Error('sample.frequency must be positive when provided');
  if (sample.taskInterval) {
    assertFiniteNonNegative(sample.taskInterval.startMs, 'taskInterval.startMs');
    assertFiniteNonNegative(sample.taskInterval.endMs, 'taskInterval.endMs');
    if (sample.taskInterval.endMs < sample.taskInterval.startMs) throw new Error('taskInterval.endMs must be >= taskInterval.startMs');
  }
}

export function buildCommandGateLatencyReport(input: {
  readonly inventory: readonly CommandGateLatencyInventoryEntry[];
  readonly samples: readonly CommandGateLatencySample[];
  readonly generatedAt?: string;
  readonly measurementOverheadMs?: number | null;
}): CommandGateLatencyReport {
  const inventoryByKey = new Map(input.inventory.map((entry) => [entry.key, entry]));
  if (inventoryByKey.size !== input.inventory.length) throw new Error('latency inventory keys must be unique');
  for (const sample of input.samples) {
    validateLatencySample(sample);
    if (!inventoryByKey.has(sample.key)) throw new Error(`sample ${sample.sampleId} is not present in inventory: ${sample.key}`);
  }
  if (input.measurementOverheadMs !== undefined && input.measurementOverheadMs !== null) assertFiniteNonNegative(input.measurementOverheadMs, 'measurementOverheadMs');

  const grouped = new Map<string, CommandGateLatencySample[]>();
  for (const sample of input.samples) grouped.set(sample.key, [...(grouped.get(sample.key) ?? []), sample]);
  const scores = input.inventory.map((entry): CommandGateLatencyScore => {
    const samples = grouped.get(entry.key) ?? [];
    const timings = samples.map(sampleTiming);
    const durations = samples.map((sample) => sample.durationMs);
    const frequency = samples.reduce((sum, sample) => sum + (sample.frequency ?? 1), 0);
    const intervals = samples.filter((sample) => sample.taskInterval).map((sample) => sample.taskInterval!);
    const cumulativeTaskWaitingMs = samples.length === 0
      ? null
      : intervals.length === samples.length
        ? unionIntervalsMs(intervals)
        : samples.reduce((sum, sample) => sum + sample.durationMs * (sample.frequency ?? 1), 0);
    return {
      key: entry.key,
      command: entry.command,
      gate: entry.gate,
      mandatory: entry.mandatory,
      applicability: entry.applicability,
      sampleCount: samples.length,
      frequency,
      p50Ms: percentileMs(durations, 0.5),
      p95Ms: percentileMs(durations, 0.95),
      inclusiveMs: timings.length === 0 ? null : percentileMs(timings.map((timing) => timing.inclusiveMs), 0.5),
      exclusiveMs: timings.length === 0 ? null : percentileMs(timings.map((timing) => timing.exclusiveMs), 0.5),
      cumulativeTaskWaitingMs,
      failureCount: samples.filter((sample) => sample.outcome === 'fail' || sample.outcome === 'blocked').length,
      timeoutCount: samples.filter((sample) => sample.outcome === 'timeout').length,
      retryCount: samples.filter((sample) => sample.outcome === 'cancelled').length,
      recoveryCount: samples.filter((sample) => sample.outcome === 'unknown').length,
      measured: samples.length > 0,
      evidenceRefs: samples.flatMap((sample) => sample.evidenceRef ? [sample.evidenceRef] : [])
    };
  });
  const measured = scores.filter((score) => score.measured);
  const mandatoryIntervals = input.samples
    .filter((sample) => sample.mandatory && sample.taskInterval)
    .map((sample) => sample.taskInterval!);
  const mandatoryTaskDurations = input.samples
    .filter((sample) => sample.mandatory && !sample.taskInterval)
    .map((sample) => sample.durationMs);
  const mandatoryTaskWaiting = mandatoryIntervals.length > 0
    ? [unionIntervalsMs(mandatoryIntervals)]
    : mandatoryTaskDurations;
  const hotspots = [...measured].sort((a, b) => (b.cumulativeTaskWaitingMs ?? -1) - (a.cumulativeTaskWaitingMs ?? -1)).slice(0, 10);
  return {
    schemaId: 'atm.commandGateLatencyScore.v1',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    inventoryCount: input.inventory.length,
    observedCount: measured.length,
    coveragePct: input.inventory.length === 0 ? 100 : (measured.length / input.inventory.length) * 100,
    uncoveredKeys: scores.filter((score) => !score.measured).map((score) => score.key),
    unknownKeys: scores.filter((score) => !score.measured).map((score) => score.key),
    mandatoryTaskWaitingP50Ms: percentileMs(mandatoryTaskWaiting, 0.5),
    mandatoryTaskWaitingP95Ms: percentileMs(mandatoryTaskWaiting, 0.95),
    measurementOverheadMs: input.measurementOverheadMs ?? null,
    scores,
    hotspots
  };
}

export function validateCommandGateLatencyReport(report: CommandGateLatencyReport): readonly string[] {
  const findings: string[] = [];
  if (report.schemaId !== 'atm.commandGateLatencyScore.v1') findings.push('schemaId mismatch');
  if (report.observedCount > report.inventoryCount) findings.push('observedCount exceeds inventoryCount');
  if (report.coveragePct < 0 || report.coveragePct > 100) findings.push('coveragePct must be between 0 and 100');
  if (report.unknownKeys.some((key) => !report.uncoveredKeys.includes(key))) findings.push('unknown keys must be uncovered');
  if (report.scores.some((score) => !score.measured && (score.p50Ms !== null || score.p95Ms !== null || score.cumulativeTaskWaitingMs !== null))) findings.push('unmeasured score cannot contain fabricated timing');
  if (report.hotspots.some((score) => !score.measured)) findings.push('hotspots must contain measured scores only');
  return findings;
}

export function compareCommandGateLatencyReports(baseline: CommandGateLatencyReport, candidate: CommandGateLatencyReport): {
  readonly mandatoryWaitingP50DeltaMs: number | null;
  readonly mandatoryWaitingP50ReductionPct: number | null;
  readonly mandatoryWaitingP95RegressionPct: number | null;
  readonly verdict: 'pass' | 'fail' | 'inconclusive';
} {
  const baselineP50 = baseline.mandatoryTaskWaitingP50Ms;
  const candidateP50 = candidate.mandatoryTaskWaitingP50Ms;
  const baselineP95 = baseline.mandatoryTaskWaitingP95Ms;
  const candidateP95 = candidate.mandatoryTaskWaitingP95Ms;
  if (baselineP50 === null || candidateP50 === null || baselineP95 === null || candidateP95 === null) {
    return { mandatoryWaitingP50DeltaMs: null, mandatoryWaitingP50ReductionPct: null, mandatoryWaitingP95RegressionPct: null, verdict: 'inconclusive' };
  }
  const delta = candidateP50 - baselineP50;
  const reductionPct = baselineP50 === 0 ? null : ((baselineP50 - candidateP50) / baselineP50) * 100;
  const p95RegressionPct = baselineP95 === 0 ? null : ((candidateP95 - baselineP95) / baselineP95) * 100;
  const verdict = reductionPct !== null && reductionPct >= 20 && (p95RegressionPct ?? Infinity) <= 10 ? 'pass' : 'fail';
  return { mandatoryWaitingP50DeltaMs: delta, mandatoryWaitingP50ReductionPct: reductionPct, mandatoryWaitingP95RegressionPct: p95RegressionPct, verdict };
}

export function buildCommandGateLatencyMarkdown(report: CommandGateLatencyReport): string {
  const rows = report.hotspots.map((score) => `| ${score.command} | ${score.gate} | ${score.mandatory ? 'yes' : 'no'} | ${score.sampleCount} | ${score.p50Ms ?? 'unknown'} | ${score.p95Ms ?? 'unknown'} | ${score.cumulativeTaskWaitingMs ?? 'unknown'} |`).join('\n');
  return [
    '# ATM command/gate latency score',
    '',
    `Generated: ${report.generatedAt}`,
    `Coverage: ${report.observedCount}/${report.inventoryCount} (${report.coveragePct.toFixed(2)}%)`,
    `Mandatory task waiting p50/p95: ${report.mandatoryTaskWaitingP50Ms ?? 'unknown'} / ${report.mandatoryTaskWaitingP95Ms ?? 'unknown'} ms`,
    `Measurement overhead: ${report.measurementOverheadMs ?? 'unknown'} ms`,
    '',
    '| command | gate | mandatory | samples | p50 ms | p95 ms | cumulative task wait ms |',
    '|---|---|---:|---:|---:|---:|---:|',
    rows || '| (no measured samples) | | | | | | |',
    '',
    `Uncovered/unknown: ${report.uncoveredKeys.length ? report.uncoveredKeys.join(', ') : 'none'}`,
    '',
    'Unknown values mean no real sample was available; they are not zero.',
    ''
  ].join('\n');
}

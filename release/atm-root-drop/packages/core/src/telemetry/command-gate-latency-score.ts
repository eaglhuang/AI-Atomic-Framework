/**
 * Command/gate latency score: a provider-neutral timing contract that
 * projects existing telemetry receipts into p50/p95, cumulative task-waiting
 * time, and a hotspot ranking. It deliberately consumes existing receipts
 * rather than creating a second telemetry store.
 *
 * Moved here from scripts/plan-performance-report-v4.ts (module-boundaries
 * violation: package runtime must not import from scripts/) so both the
 * packaged CLI (telemetry.ts) and the framework-repo script can share one
 * definition without the published package depending on scripts/.
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

/** Structural subset of the existing gate telemetry event used for projection. */
export type CommandGateTelemetryEvent = {
  readonly eventId?: string;
  readonly checkId: string;
  readonly gate: string;
  readonly command?: string;
  readonly durationMs: number;
  readonly result: string;
  readonly taskId?: string | null;
  readonly runId?: string | null;
  readonly evidenceReadRef?: string | null;
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

/**
 * Project the already-recorded gate telemetry events into the latency score.
 * This keeps the event stream as the sole source of truth; no second store is
 * created and absent runtime events remain unknown.
 */
export function buildCommandGateLatencyReportFromEvents(input: {
  readonly inventory: readonly CommandGateLatencyInventoryEntry[];
  readonly events: readonly CommandGateTelemetryEvent[];
  readonly mandatoryKeys?: readonly string[];
  readonly generatedAt?: string;
  readonly measurementOverheadMs?: number | null;
}): CommandGateLatencyReport {
  const mandatory = new Set(input.mandatoryKeys ?? []);
  const inventoryByKey = new Map(input.inventory.map((entry) => [entry.key, entry]));
  const samples = input.events
    .filter((event) => inventoryByKey.has(event.checkId))
    .map((event, index): CommandGateLatencySample => {
      const entry = inventoryByKey.get(event.checkId)!;
      return {
        sampleId: event.eventId ?? `${event.checkId}-${index}`,
        key: entry.key,
        command: event.command ?? entry.command,
        gate: event.gate || entry.gate,
        mandatory: mandatory.has(entry.key) || entry.mandatory,
        applicability: entry.applicability,
        durationMs: event.durationMs,
        outcome: event.result === 'block' ? 'blocked' : event.result === 'error' ? 'fail' : event.result === 'warn' || event.result === 'skip' ? 'unknown' : 'pass',
        taskId: event.taskId ?? null,
        runId: event.runId ?? null,
        evidenceRef: event.evidenceReadRef ?? null
      };
    });
  return buildCommandGateLatencyReport({
    inventory: input.inventory,
    samples,
    generatedAt: input.generatedAt,
    measurementOverheadMs: input.measurementOverheadMs
  });
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

export type BenchmarkArm = 'baseline' | 'atm';

export interface RawBenchmarkRun {
  readonly runId: string;
  readonly roundId: string;
  readonly sequence: 'AB' | 'BA';
  readonly arm: BenchmarkArm;
  readonly repository: string;
  readonly commitSha: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly prompt: string;
  readonly tokens: number | null;
  readonly billedCost: number | null;
  readonly humanMinutes: number | null;
  readonly retries: number | null;
  readonly commands: readonly string[];
  readonly repairs: readonly string[];
  readonly environmentDigest: string;
  /** Oracle-adjudicated completion. Missing/null is never treated as success. */
  readonly completion?: boolean | null;
  /** Observed repair duration; null means the source did not provide it. */
  readonly repairTimeMs?: number | null;
}

export interface RawBenchmarkAggregate {
  readonly arm: BenchmarkArm;
  readonly runCount: number;
  readonly durationMs: readonly number[];
  readonly p95DurationMs: number;
  readonly billedCost: number | null;
  readonly humanMinutes: number | null;
  readonly retries: number | null;
  readonly repairTimeMs: number | null;
  readonly tokens?: number | null;
  readonly completionRate?: number | null;
  readonly totalCost?: number | null;
  readonly costBreakdown?: { readonly api: number | null; readonly human: number | null; readonly compute: number | null; readonly ratePerHour: number | null };
  readonly clusterIds?: readonly string[];
  readonly pairIds?: readonly string[];
}

export interface ExecutionArmRawEvidence {
  readonly schemaId: 'atm.benchmarkArmRawEvidence.v1';
  readonly pairId: string;
  readonly arm: BenchmarkArm;
  readonly repositoryUrl: string;
  readonly commitSha: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly wallClockMs: number;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string;
  readonly packageVersion: string | null;
  readonly promptDigest: string;
  readonly tokens: number | null;
  readonly costUsd: number | null;
  readonly command: string;
  readonly driverEvidence?: Record<string, unknown>;
  readonly telemetry: {
    readonly completion: 'completed' | 'failed' | 'aborted' | 'unknown' | null;
    readonly completionEvidence: string | null;
    readonly humanMinutes: number | null;
    readonly humanIntervals: readonly { readonly startedAt: string; readonly endedAt: string }[] | null;
    readonly retries: number | null;
    readonly repairTimeMs: number | null;
    readonly repairTimestamps: readonly { readonly startedAt: string; readonly endedAt: string }[] | null;
    readonly unavailableReasons: readonly string[];
  };
}

export interface ExecutionRunContext {
  readonly runId: string;
  readonly roundId: string;
  readonly sequence: 'AB' | 'BA';
  readonly prompt: string;
  readonly environmentDigest: string;
}

function intervalTotalMs(intervals: readonly { readonly startedAt: string; readonly endedAt: string }[] | null): number | null {
  if (intervals === null) return null;
  let total = 0;
  for (const interval of intervals) {
    const started = Date.parse(interval.startedAt);
    const ended = Date.parse(interval.endedAt);
    if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return null;
    total += ended - started;
  }
  return total;
}

/** Convert the executor's raw sink record into the one metrics contract. */
export function rawRunFromExecutionEvidence(
  input: ExecutionArmRawEvidence,
  context: ExecutionRunContext
): RawBenchmarkRun {
  const completion = input.telemetry.completionEvidence && input.telemetry.completion === 'completed'
    ? true
    : input.telemetry.completionEvidence && input.telemetry.completion !== 'unknown'
      ? false
      : null;
  const rawEvidence = input.driverEvidence ?? {};
  const repairs = Array.isArray(rawEvidence.repairs) ? rawEvidence.repairs.filter((value): value is string => typeof value === 'string') : [];
  const humanIntervalMs = intervalTotalMs(input.telemetry.humanIntervals);
  const repairIntervalMs = intervalTotalMs(input.telemetry.repairTimestamps);
  return {
    runId: context.runId,
    roundId: context.roundId,
    sequence: context.sequence,
    arm: input.arm,
    repository: input.repositoryUrl,
    commitSha: input.commitSha,
    startedAt: input.startedAt,
    finishedAt: input.completedAt,
    prompt: context.prompt,
    tokens: input.tokens,
    billedCost: input.costUsd,
    humanMinutes: input.telemetry.humanMinutes ?? (humanIntervalMs === null ? null : humanIntervalMs / 60000),
    retries: input.telemetry.retries,
    commands: [input.command],
    repairs,
    environmentDigest: context.environmentDigest,
    completion,
    repairTimeMs: input.telemetry.repairTimeMs ?? repairIntervalMs,
  };
}

/** Adapt the executor sink in one deterministic pass before runner aggregation. */
export function rawRunsFromExecutionEvidence(
  inputs: readonly ExecutionArmRawEvidence[],
  contexts: readonly ExecutionRunContext[],
): RawBenchmarkRun[] {
  if (inputs.length !== contexts.length) throw new Error('execution evidence and run contexts must have equal lengths');
  return inputs.map((input, index) => rawRunFromExecutionEvidence(input, contexts[index]));
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid raw timestamp for ${field}`);
  return parsed;
}

function percentile95(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) throw new Error('cannot calculate p95 without raw runs');
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

export function validateRawRun(run: RawBenchmarkRun): void {
  if (!run.runId || !run.roundId || !run.prompt || !run.repository || !/^[a-f0-9]{40}$/.test(run.commitSha)) {
    throw new Error('raw run is missing sealed identity, prompt, repository, or commit');
  }
  if (run.sequence !== 'AB' && run.sequence !== 'BA') throw new Error('raw run sequence must be AB or BA');
  if (run.arm !== 'baseline' && run.arm !== 'atm') throw new Error('raw run arm is invalid');
  if (!Array.isArray(run.commands) || !Array.isArray(run.repairs) || !run.environmentDigest) throw new Error('raw run must retain commands, repairs, and environment digest');
  if ((run.humanMinutes !== null && (!Number.isFinite(run.humanMinutes) || run.humanMinutes < 0)) || (run.retries !== null && (!Number.isInteger(run.retries) || run.retries < 0))) throw new Error('raw run human minutes or retries are invalid');
  if (run.tokens !== null && (!Number.isFinite(run.tokens) || run.tokens < 0)) throw new Error('raw run tokens are invalid');
  if (run.billedCost !== null && (!Number.isFinite(run.billedCost) || run.billedCost < 0)) throw new Error('raw run billed cost is invalid');
  if (run.completion !== undefined && run.completion !== null && typeof run.completion !== 'boolean') throw new Error('raw run completion is invalid');
  if (run.repairTimeMs !== undefined && run.repairTimeMs !== null && (!Number.isFinite(run.repairTimeMs) || run.repairTimeMs < 0)) throw new Error('raw run repair time is invalid');
  if (timestamp(run.finishedAt, 'finishedAt') < timestamp(run.startedAt, 'startedAt')) throw new Error('raw run finished before it started');
}

export function aggregateRawRuns(runs: readonly RawBenchmarkRun[], arm: BenchmarkArm): RawBenchmarkAggregate {
  const selected = runs.filter((run) => run.arm === arm);
  if (selected.length === 0) throw new Error(`no raw runs for ${arm}`);
  selected.forEach(validateRawRun);
  const durationMs = selected.map((run) => timestamp(run.finishedAt, 'finishedAt') - timestamp(run.startedAt, 'startedAt'));
  const allCostsPresent = selected.every((run) => run.billedCost !== null);
  return {
    arm,
    runCount: selected.length,
    durationMs,
    p95DurationMs: percentile95(durationMs),
    billedCost: allCostsPresent ? selected.reduce((total, run) => total + (run.billedCost ?? 0), 0) : null,
    humanMinutes: selected.every(run => run.humanMinutes !== null) ? selected.reduce((total, run) => total + (run.humanMinutes ?? 0), 0) : null,
    retries: selected.every(run => run.retries !== null) ? selected.reduce((total, run) => total + (run.retries ?? 0), 0) : null,
    repairTimeMs: selected.every(run => run.repairTimeMs !== undefined && run.repairTimeMs !== null)
      ? selected.reduce((total, run) => total + (run.repairTimeMs ?? 0), 0)
      : null,
    tokens: selected.every(run => run.tokens !== null) ? selected.reduce((total, run) => total + (run.tokens ?? 0), 0) : null,
    completionRate: selected.every(run => typeof run.completion === 'boolean')
      ? selected.filter(run => run.completion === true).length / selected.length
      : null,
    clusterIds: [...new Set(selected.map(run => run.roundId))],
    pairIds: [...new Set(selected.map(run => run.roundId))]
  };
}

export interface TotalCostPolicy { readonly humanRatePerHour: number; readonly computeCostByRun?: ReadonlyMap<string, number>; }
export function applyTotalCostPolicy(aggregate: RawBenchmarkAggregate, runs: readonly RawBenchmarkRun[], policy: TotalCostPolicy): RawBenchmarkAggregate {
  if (!Number.isFinite(policy.humanRatePerHour) || policy.humanRatePerHour < 0) throw new Error('human hourly rate is invalid');
  const selected = runs.filter(run => run.arm === aggregate.arm);
  const api = aggregate.billedCost;
  const human = aggregate.humanMinutes === null ? null : aggregate.humanMinutes * policy.humanRatePerHour / 60;
  const compute = policy.computeCostByRun && selected.every(run => policy.computeCostByRun?.has(run.runId)) ? selected.reduce((sum, run) => sum + (policy.computeCostByRun?.get(run.runId) ?? 0), 0) : null;
  return { ...aggregate, totalCost: api === null || human === null || compute === null ? null : api + human + compute, costBreakdown: { api, human, compute, ratePerHour: policy.humanRatePerHour } };
}

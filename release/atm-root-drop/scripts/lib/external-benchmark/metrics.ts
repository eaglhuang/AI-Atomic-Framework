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
  readonly retries: number;
  readonly commands: readonly string[];
  readonly repairs: readonly string[];
  readonly environmentDigest: string;
}

export interface RawBenchmarkAggregate {
  readonly arm: BenchmarkArm;
  readonly runCount: number;
  readonly durationMs: readonly number[];
  readonly p95DurationMs: number;
  readonly billedCost: number | null;
  readonly humanMinutes: number | null;
  readonly retries: number;
  readonly tokens?: number | null;
  readonly completionRate?: number | null;
  readonly totalCost?: number | null;
  readonly costBreakdown?: { readonly api: number | null; readonly human: number | null; readonly compute: number | null; readonly ratePerHour: number | null };
  readonly clusterIds?: readonly string[];
  readonly pairIds?: readonly string[];
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
  if ((run.humanMinutes !== null && (!Number.isFinite(run.humanMinutes) || run.humanMinutes < 0)) || !Number.isInteger(run.retries) || run.retries < 0) throw new Error('raw run human minutes or retries are invalid');
  if (run.tokens !== null && (!Number.isFinite(run.tokens) || run.tokens < 0)) throw new Error('raw run tokens are invalid');
  if (run.billedCost !== null && (!Number.isFinite(run.billedCost) || run.billedCost < 0)) throw new Error('raw run billed cost is invalid');
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
    retries: selected.reduce((total, run) => total + run.retries, 0),
    tokens: selected.every(run => run.tokens !== null) ? selected.reduce((total, run) => total + (run.tokens ?? 0), 0) : null,
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

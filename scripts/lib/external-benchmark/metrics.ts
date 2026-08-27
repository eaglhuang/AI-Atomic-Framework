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
  readonly humanMinutes: number;
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
  readonly humanMinutes: number;
  readonly retries: number;
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
  if (!Number.isFinite(run.humanMinutes) || run.humanMinutes < 0 || !Number.isInteger(run.retries) || run.retries < 0) throw new Error('raw run human minutes or retries are invalid');
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
    humanMinutes: selected.reduce((total, run) => total + run.humanMinutes, 0),
    retries: selected.reduce((total, run) => total + run.retries, 0)
  };
}

import { createValidator } from './lib/validator-harness.ts';
import { aggregateRawRuns, type RawBenchmarkRun } from './lib/external-benchmark/metrics.ts';

const harness = createValidator('external-benchmark-metrics', { argv: process.argv.slice(2), defaultMode: 'validate' });

const run = (arm: 'baseline' | 'atm', id: string, cost: number | null): RawBenchmarkRun => ({
  runId: id,
  roundId: id,
  sequence: id === 'baseline-ab' ? 'AB' : 'BA',
  arm,
  repository: 'example/repo',
  commitSha: 'a'.repeat(40),
  startedAt: '2026-09-12T00:00:00.000Z',
  finishedAt: '2026-09-12T00:00:01.000Z',
  prompt: 'sealed benchmark task',
  tokens: 10,
  billedCost: cost,
  humanMinutes: 1,
  retries: 0,
  commands: ['git status'],
  repairs: [],
  environmentDigest: 'sha256:test'
});

function validate(): void {
  harness.requireFile('scripts/lib/external-benchmark/metrics.ts');
  const baseline = aggregateRawRuns([run('baseline', 'baseline-ab', 10), run('baseline', 'baseline-ba', 20)], 'baseline');
  const atm = aggregateRawRuns([run('atm', 'atm-ab', 5), run('atm', 'atm-ba', 5)], 'atm');
  harness.assert(baseline.runCount === 2 && atm.runCount === 2, 'both benchmark arms must have raw runs');
  harness.assert(baseline.p95DurationMs === 1000 && atm.p95DurationMs === 1000, 'p95 must derive from raw timestamps');
  harness.assert(baseline.billedCost === 30 && atm.billedCost === 10, 'billed cost must aggregate only complete raw telemetry');
  harness.assert(atm.humanMinutes === 2 && atm.retries === 0, 'human minutes and retries must be retained');
  let rejectedInvalidTimestamp = false;
  try {
    aggregateRawRuns([{ ...run('atm', 'bad', 1), startedAt: 'invalid' }], 'atm');
  } catch (error) {
    rejectedInvalidTimestamp = /invalid raw timestamp/.test(String(error));
  }
  harness.assert(rejectedInvalidTimestamp, 'invalid timestamps must be rejected');
  harness.ok('arms=2 runs=4 p95=raw-timestamps billedCost=complete-only');
}

validate();

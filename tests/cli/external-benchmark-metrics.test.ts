import assert from 'node:assert/strict';
import { aggregateRawRuns, type RawBenchmarkRun } from '../../scripts/lib/external-benchmark/metrics.ts';

const run = (arm: 'baseline' | 'atm', id: string, cost: number | null): RawBenchmarkRun => ({ runId: id, roundId: id, sequence: id === 'one' ? 'AB' : 'BA', arm, repository: 'example/repo', commitSha: 'a'.repeat(40), startedAt: '2026-08-28T00:00:00.000Z', finishedAt: '2026-08-28T00:00:01.000Z', prompt: 'implement task', tokens: 10, billedCost: cost, humanMinutes: 1, retries: 0, commands: ['git status'], repairs: [], environmentDigest: 'sha256:test' });

const aggregate = aggregateRawRuns([run('baseline', 'one', 10), run('baseline', 'two', 20)], 'baseline');
assert.equal(aggregate.p95DurationMs, 1000);
assert.equal(aggregate.billedCost, 30);
assert.throws(() => aggregateRawRuns([run('atm', 'one', 1), { ...run('atm', 'two', 1), startedAt: 'invalid' }], 'atm'), /invalid raw timestamp/);
console.log('external-benchmark-metrics ok');

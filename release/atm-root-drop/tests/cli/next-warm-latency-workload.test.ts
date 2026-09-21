import assert from 'node:assert/strict';
import { createNextWarmLatencyWorkload } from '../../scripts/lib/next-warm-latency-workload.ts';

const planningRoot = 'C:/planning/authority';
const first = createNextWarmLatencyWorkload(planningRoot);
const second = createNextWarmLatencyWorkload(planningRoot);

assert.deepEqual(first, second, 'the declared latency workload must be byte-stable');
assert.deepEqual(first.args.slice(0, 3), ['next', '--prompt', 'Inspect repository orientation for a deterministic latency sample.']);
assert.equal(first.args[first.args.indexOf('--planning-root') + 1], planningRoot);
assert.equal(first.args.at(-1), '--json');
assert.match(first.digest, /^sha256:[a-f0-9]{64}$/);

console.log('[next-warm-latency-workload.test] ok');

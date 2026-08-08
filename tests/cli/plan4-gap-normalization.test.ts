import assert from 'node:assert/strict';
import { normalizeGaps } from '../../packages/core/src/evidence/gap-planning.ts';

const result = normalizeGaps([
  { kind: 'missing-test', target: 'alpha', dimension: 'behavior', expected: 'pass', observed: 'absent', provenance: { actor: 'a', path: '/tmp/a' } },
  { kind: 'missing-test', target: 'alpha', dimension: 'behavior', expected: 'pass', observed: 'absent', provenance: { actor: 'b', date: '2020-01-01' } }
]);
assert.equal(result.status, 'proven');
assert.equal(result.gaps.length, 1);
assert.equal(result.gaps[0].gapId, normalizeGaps([...result.gaps.map(({ kind, target, dimension, expected, observed }) => ({ kind, target, dimension, expected, observed }))]).gaps[0].gapId);
assert.equal(normalizeGaps([{ kind: 'missing-test', target: 'alpha', dimension: 'behavior', expected: 'pass', observed: 'absent' }, { kind: 'missing-test', target: 'alpha', dimension: 'behavior', expected: 'pass', observed: 'present' }]).status, 'blocked');
console.log('plan4 gap normalization: ok');

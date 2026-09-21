import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { compileHostileDogfood } from '../../packages/core/src/evidence/hostile-dogfood.ts';

const requiredConditions = ['shared-index', 'cas-head-moved', 'queue-race', 'foreign-dirty', 'stale-runner'];

function digest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

// Integration fixtures are deliberately executed as separate command-backed
// evidence.  Keeping this compiler test fast prevents a phase-exit unit gate
// from serialising independent long-running dogfood experiments.
const lanes = [
  { laneId: 'fixture-captain-a', actorId: 'fixture-captain-a', receiptDigest: digest('lane-a'), sealed: true },
  { laneId: 'fixture-captain-b', actorId: 'fixture-captain-b', receiptDigest: digest('lane-b'), sealed: true }
];
const conditions = [
  { condition: 'shared-index', outcome: 'recovered' as const, rollbackPreserved: true, canonicalWorktreeIntact: true },
  { condition: 'cas-head-moved', outcome: 'recovered' as const, rollbackPreserved: true, canonicalWorktreeIntact: true },
  { condition: 'queue-race', outcome: 'recovered' as const, rollbackPreserved: true, canonicalWorktreeIntact: true },
  { condition: 'foreign-dirty', outcome: 'recovered' as const, rollbackPreserved: true, canonicalWorktreeIntact: true },
  { condition: 'stale-runner', outcome: 'recovered' as const, rollbackPreserved: true, canonicalWorktreeIntact: true }
];

const green = compileHostileDogfood({
  sealedReceiptDigest: digest('sealed-fixture-receipts'),
  lanes,
  conditions,
  requiredConditions
});
assert.equal(green.status, 'proven');
assert.equal(green.saturation.conditionCount, 5);
assert.equal(green.saturation.recurrenceCount, 5);
assert.equal(green.saturation.independentLaneCount, 2);
assert.equal(green.rollbackPreserved, true);
assert.equal(green.canonicalWorktreeIntact, true);

const missingFamily = compileHostileDogfood({
  sealedReceiptDigest: digest('receipt'),
  lanes,
  conditions: conditions.filter((item) => item.condition !== 'foreign-dirty'),
  requiredConditions
});
assert.equal(missingFamily.status, 'blocked');
assert.ok(missingFamily.diagnostics.includes('required-condition-missing:foreign-dirty'));

const nonIndependentLanes = compileHostileDogfood({
  sealedReceiptDigest: digest('receipt'),
  lanes: [lanes[0], { ...lanes[0], receiptDigest: digest('second') }],
  conditions,
  requiredConditions
});
assert.equal(nonIndependentLanes.status, 'blocked');
assert.ok(nonIndependentLanes.diagnostics.includes('lane-id-not-independent:fixture-captain-a'));

const unknown = compileHostileDogfood({
  sealedReceiptDigest: digest('receipt'),
  lanes,
  conditions: conditions.map((item) => item.condition === 'queue-race' ? { ...item, outcome: 'unknown' as const } : item),
  requiredConditions
});
assert.equal(unknown.status, 'blocked');
assert.ok(unknown.diagnostics.includes('unknown-outcome:queue-race'));

const override = compileHostileDogfood({
  sealedReceiptDigest: digest('receipt'),
  lanes,
  conditions: conditions.map((item) => item.condition === 'shared-index' ? { ...item, overrideLeaseUsed: true } : item),
  requiredConditions
});
assert.equal(override.status, 'blocked');
assert.ok(override.diagnostics.includes('override-lease-forbidden:shared-index'));

console.log('plan4 hostile dual captain: ok');

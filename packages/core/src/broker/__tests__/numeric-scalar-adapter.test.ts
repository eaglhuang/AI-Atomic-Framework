import assert from 'node:assert/strict';
import { numericScalarAdapter } from '../adapters/numeric-scalar.ts';
import { brokerAdapterMigration, type FileDescriptor, type MutationRequest } from '../types.ts';

function makeFile(content: string, filePath = 'metrics.scalars.json'): FileDescriptor {
  return { filePath, content };
}

function makeRequest(overrides: Partial<MutationRequest> & Pick<MutationRequest, 'op' | 'target'>): MutationRequest {
  return {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    requestId: 'req-1',
    actorId: 'actor-a',
    filePath: 'metrics.scalars.json',
    value: undefined,
    ...overrides
  };
}

function testTwoIncrementsCommutativeMerge() {
  const parsed = numericScalarAdapter.parse(makeFile('{"hits": 5}'));
  const i1 = numericScalarAdapter.normalize(makeRequest({ requestId: 'r1', op: 'increment', target: 'hits', value: 3 }));
  const i2 = numericScalarAdapter.normalize(makeRequest({ requestId: 'r2', op: 'increment', target: 'hits', value: 4 }));
  const decision = numericScalarAdapter.canMerge([i1, i2], parsed);
  assert.equal(decision.verdict, 'commutative-merge');
  const merged = numericScalarAdapter.merge([i1, i2], parsed);
  assert.equal((merged.value as { values: Record<string, number> }).values.hits, 12);
  console.log('ok: two increments => commutative-merge, summed net delta');
}

function testIncrementDecrementNetDelta() {
  const parsed = numericScalarAdapter.parse(makeFile('{"bal": 100}'));
  const inc = numericScalarAdapter.normalize(makeRequest({ requestId: 'r1', op: 'increment', target: 'bal', value: 30 }));
  const dec = numericScalarAdapter.normalize(makeRequest({ requestId: 'r2', op: 'decrement', target: 'bal', value: 10 }));
  const decision = numericScalarAdapter.canMerge([inc, dec], parsed);
  assert.equal(decision.verdict, 'commutative-merge');
  const merged = numericScalarAdapter.merge([inc, dec], parsed);
  assert.equal((merged.value as { values: Record<string, number> }).values.bal, 120);
  console.log('ok: increment + decrement => net delta');
}

function testIncrementPlusSetIfCurrentConflict() {
  const parsed = numericScalarAdapter.parse(makeFile('{"v": 1}'));
  const inc = numericScalarAdapter.normalize(makeRequest({ requestId: 'r1', op: 'increment', target: 'v', value: 1 }));
  const cas = numericScalarAdapter.normalize(makeRequest({ requestId: 'r2', op: 'set-if-current', target: 'v', value: { expected: 1, next: 9 } }));
  const decision = numericScalarAdapter.canMerge([inc, cas], parsed);
  assert.equal(decision.verdict, 'conflict');
  assert.throws(() => numericScalarAdapter.merge([inc, cas], parsed));
  console.log('ok: increment + set-if-current => conflict');
}

function testMaxMinBehavior() {
  const parsed = numericScalarAdapter.parse(makeFile('{"peak": 50}'));
  const max1 = numericScalarAdapter.normalize(makeRequest({ requestId: 'r1', op: 'max', target: 'peak', value: 70 }));
  const max2 = numericScalarAdapter.normalize(makeRequest({ requestId: 'r2', op: 'max', target: 'peak', value: 60 }));
  const decision = numericScalarAdapter.canMerge([max1, max2], parsed);
  assert.equal(decision.verdict, 'commutative-merge');
  const merged = numericScalarAdapter.merge([max1, max2], parsed);
  assert.equal((merged.value as { values: Record<string, number> }).values.peak, 70);

  const minParsed = numericScalarAdapter.parse(makeFile('{"low": 50}'));
  const min1 = numericScalarAdapter.normalize(makeRequest({ requestId: 'r3', op: 'min', target: 'low', value: 30 }));
  const mergedMin = numericScalarAdapter.merge([min1], minParsed);
  assert.equal((mergedMin.value as { values: Record<string, number> }).values.low, 30);
  console.log('ok: max/min commutative behavior');
}

function testSetIfCurrentApplies() {
  const parsed = numericScalarAdapter.parse(makeFile('{"v": 7}'));
  const cas = numericScalarAdapter.normalize(makeRequest({ requestId: 'r1', op: 'set-if-current', target: 'v', value: { expected: 7, next: 99 } }));
  const merged = numericScalarAdapter.merge([cas], parsed);
  assert.equal((merged.value as { values: Record<string, number> }).values.v, 99);
  // Stale expectation throws.
  const stale = numericScalarAdapter.normalize(makeRequest({ requestId: 'r2', op: 'set-if-current', target: 'v', value: { expected: 1, next: 2 } }));
  assert.throws(() => numericScalarAdapter.merge([stale], parsed));
  console.log('ok: set-if-current applies on match, throws on stale');
}

testTwoIncrementsCommutativeMerge();
testIncrementDecrementNetDelta();
testIncrementPlusSetIfCurrentConflict();
testMaxMinBehavior();
testSetIfCurrentApplies();

console.log('all numeric-scalar-adapter tests passed');

import assert from 'node:assert/strict';
import { conflictKeysOverlap } from '../conflict-key-overlap.ts';
import { brokerAdapterMigration, type ConflictKey } from '../types.ts';

function key(scope: ConflictKey['scope'], value: string): ConflictKey {
  return {
    schemaId: 'atm.conflictKey.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    scope,
    key: value
  };
}

function testJsonPointerEquality() {
  assert.equal(
    conflictKeysOverlap(
      key('record', 'record:config.json::/paths/users'),
      key('record', 'record:config.json::/paths/users')
    ),
    true
  );
  assert.equal(
    conflictKeysOverlap(
      key('record', 'record:config.json::/paths/users'),
      key('record', 'record:config.json::/paths/orders')
    ),
    false
  );
  console.log('ok: JSON pointer equality/disjoint');
}

function testNumericScalarEquality() {
  assert.equal(
    conflictKeysOverlap(
      key('scalar', 'scalar:stats.counter.json::wins'),
      key('scalar', 'scalar:stats.counter.json::wins')
    ),
    true
  );
  assert.equal(
    conflictKeysOverlap(
      key('scalar', 'scalar:stats.counter.json::wins'),
      key('scalar', 'scalar:stats.counter.json::losses')
    ),
    false
  );
  console.log('ok: numeric scalar equality/disjoint');
}

function testTextRangeOverlap() {
  assert.equal(
    conflictKeysOverlap(
      key('range', 'range:notes.md::10-20'),
      key('range', 'range:notes.md::18-30')
    ),
    true
  );
  assert.equal(
    conflictKeysOverlap(
      key('range', 'range:notes.md::10-20'),
      key('range', 'range:notes.md::21-30')
    ),
    false
  );
  console.log('ok: text-range overlap/disjoint');
}

function testAtomMapRowEquality() {
  assert.equal(
    conflictKeysOverlap(
      key('record', 'record:packages/core/src/a.ts::ATOM-A'),
      key('record', 'record:packages/core/src/a.ts::ATOM-A')
    ),
    true
  );
  assert.equal(
    conflictKeysOverlap(
      key('record', 'record:packages/core/src/a.ts::ATOM-A'),
      key('record', 'record:packages/core/src/b.ts::ATOM-B')
    ),
    false
  );
  console.log('ok: atom-map row equality/disjoint');
}

function testAtomMapMetadataWidening() {
  assert.equal(
    conflictKeysOverlap(
      key('file', 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-core.json'),
      key('record', 'record:packages/core/src/a.ts::ATOM-A')
    ),
    false
  );
  assert.equal(
    conflictKeysOverlap(
      key('file', 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-core.json'),
      key('file', 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-core.json')
    ),
    true
  );
  console.log('ok: atom-map metadata file-scope widening');
}

testJsonPointerEquality();
testNumericScalarEquality();
testTextRangeOverlap();
testAtomMapRowEquality();
testAtomMapMetadataWidening();

console.log('all conflict-key-overlap tests passed');

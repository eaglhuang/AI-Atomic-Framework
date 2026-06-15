import assert from 'node:assert/strict';
import { pathToAtomMapAdapter } from '../adapters/atom-map.ts';
import { brokerAdapterMigration, type FileDescriptor, type MutationRequest } from '../types.ts';

const SHARD_PATH = 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-core.json';

function makeShard(): string {
  return `${JSON.stringify(
    {
      schemaId: 'atm.pathToAtomMapOwnerShard.v1',
      owner: 'core',
      version: '1.0',
      mappings: [
        { path_pattern: 'packages/core/src/a.ts', atom_id: 'ATOM-A', capability: 'cap-a', coverage_status: 'covered' },
        { path_pattern: 'packages/core/src/b.ts', atom_id: 'ATOM-B', capability: 'cap-b', coverage_status: 'debt' }
      ]
    },
    null,
    2
  )}\n`;
}

function makeFile(content = makeShard(), filePath = SHARD_PATH): FileDescriptor {
  return { filePath, content };
}

function makeRequest(overrides: Partial<MutationRequest> & Pick<MutationRequest, 'op' | 'target'>): MutationRequest {
  return {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    requestId: 'req-1',
    actorId: 'actor-a',
    filePath: SHARD_PATH,
    value: undefined,
    ...overrides
  };
}

function testSupportsMatchingRule() {
  assert.equal(pathToAtomMapAdapter.supports(makeFile()), true);
  // Backslash (Windows) path still matches.
  assert.equal(
    pathToAtomMapAdapter.supports(makeFile(makeShard(), SHARD_PATH.replace(/\//g, '\\'))),
    true
  );
  // The projection itself and manifest are NOT supported.
  assert.equal(
    pathToAtomMapAdapter.supports(makeFile(makeShard(), 'atomic_workbench/atomization-coverage/path-to-atom-map.json')),
    false
  );
  assert.equal(
    pathToAtomMapAdapter.supports(makeFile(makeShard(), 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/manifest.json')),
    false
  );
  console.log('ok: supports matches owner-shard files only');
}

function testDifferentRowsMergeable() {
  const parsed = pathToAtomMapAdapter.parse(makeFile());
  const m1 = pathToAtomMapAdapter.normalize(
    makeRequest({ requestId: 'r1', op: 'replace', target: 'packages/core/src/a.ts::ATOM-A', value: { path_pattern: 'packages/core/src/a.ts', atom_id: 'ATOM-A', capability: 'cap-a2', coverage_status: 'covered' } })
  );
  const m2 = pathToAtomMapAdapter.normalize(
    makeRequest({ requestId: 'r2', op: 'replace', target: 'packages/core/src/b.ts::ATOM-B', value: { path_pattern: 'packages/core/src/b.ts', atom_id: 'ATOM-B', capability: 'cap-b2', coverage_status: 'covered' } })
  );
  const decision = pathToAtomMapAdapter.canMerge([m1, m2], parsed);
  assert.equal(decision.verdict, 'mergeable');
  const merged = pathToAtomMapAdapter.merge([m1, m2], parsed) as { value: { mappings: { atom_id: string; capability: string }[] } };
  assert.equal(merged.value.mappings.length, 2);
  assert.equal(merged.value.mappings.find((m) => m.atom_id === 'ATOM-A')!.capability, 'cap-a2');
  console.log('ok: different rows => mergeable');
}

function testSameRowConflict() {
  const parsed = pathToAtomMapAdapter.parse(makeFile());
  const m1 = pathToAtomMapAdapter.normalize(
    makeRequest({ requestId: 'r1', op: 'replace', target: 'packages/core/src/a.ts::ATOM-A', value: { path_pattern: 'packages/core/src/a.ts', atom_id: 'ATOM-A', capability: 'x', coverage_status: 'covered' } })
  );
  const m2 = pathToAtomMapAdapter.normalize(
    makeRequest({ requestId: 'r2', op: 'replace', target: 'packages/core/src/a.ts::ATOM-A', value: { path_pattern: 'packages/core/src/a.ts', atom_id: 'ATOM-A', capability: 'y', coverage_status: 'covered' } })
  );
  const decision = pathToAtomMapAdapter.canMerge([m1, m2], parsed);
  assert.equal(decision.verdict, 'conflict');
  assert.ok(decision.conflictKeys.length > 0);
  assert.equal(decision.conflictKeys[0].scope, 'record');
  assert.equal(decision.conflictKeys[0].key, 'record:packages/core/src/a.ts::ATOM-A');
  assert.throws(() => pathToAtomMapAdapter.merge([m1, m2], parsed));
  console.log('ok: same (path_pattern, atom_id) => conflict');
}

function testMetadataChangeWidensConflictKey() {
  const parsed = pathToAtomMapAdapter.parse(makeFile());
  const rowMutation = pathToAtomMapAdapter.normalize(
    makeRequest({ requestId: 'r1', op: 'replace', target: 'packages/core/src/a.ts::ATOM-A', value: { path_pattern: 'packages/core/src/a.ts', atom_id: 'ATOM-A', capability: 'z', coverage_status: 'covered' } })
  );
  const metaMutation = pathToAtomMapAdapter.normalize(
    makeRequest({ requestId: 'r2', op: 'upsert', target: 'version', value: '2.0' })
  );
  const metaKeys = pathToAtomMapAdapter.getConflictKeys(metaMutation, parsed);
  assert.equal(metaKeys[0].scope, 'file');
  assert.equal(metaKeys[0].key, SHARD_PATH);
  // The metadata mutation widens to the whole shard, so it does NOT collide with
  // the row mutation (distinct keys) but represents a file-scope surface that the
  // planner treats as serializing against any row write.
  const decision = pathToAtomMapAdapter.canMerge([rowMutation, metaMutation], parsed);
  assert.equal(decision.verdict, 'mergeable');
  // Two metadata mutations collide on the same file key.
  const metaMutation2 = pathToAtomMapAdapter.normalize(
    makeRequest({ requestId: 'r3', op: 'upsert', target: 'summary', value: { mapped_paths: 2 } })
  );
  const metaDecision = pathToAtomMapAdapter.canMerge([metaMutation, metaMutation2], parsed);
  assert.equal(metaDecision.verdict, 'conflict');
  console.log('ok: metadata changes widen to {scope:file, key:shardPath}');
}

function testSerializeRoundTrip() {
  const parsed = pathToAtomMapAdapter.parse(makeFile());
  const upsert = pathToAtomMapAdapter.normalize(
    makeRequest({ requestId: 'r1', op: 'upsert', target: 'packages/core/src/c.ts::ATOM-C', value: { path_pattern: 'packages/core/src/c.ts', atom_id: 'ATOM-C', capability: 'cap-c', coverage_status: 'planned' } })
  );
  const merged = pathToAtomMapAdapter.merge([upsert], parsed);
  const serialized = pathToAtomMapAdapter.serialize(merged);
  const reparsed = pathToAtomMapAdapter.parse(makeFile(serialized));
  assert.deepEqual(reparsed.value, merged.value);
  const validation = pathToAtomMapAdapter.validate!(makeFile(serialized));
  assert.equal(validation.ok, true);
  console.log('ok: parse->merge->serialize round-trips and validates');
}

testSupportsMatchingRule();
testDifferentRowsMergeable();
testSameRowConflict();
testMetadataChangeWidensConflictKey();
testSerializeRoundTrip();

console.log('all atom-map-adapter tests passed');

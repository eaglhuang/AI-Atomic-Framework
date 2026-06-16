import assert from 'node:assert/strict';
import {
  FALLBACK_ADAPTER_ID,
  createAdapterRegistry,
  defaultAdapterRegistry,
  registerAdapter,
  resolveAdapter
} from '../adapters/index.ts';
import { brokerAdapterMigration, type FileDescriptor, type FileMutationAdapter } from '../types.ts';

function makeFile(filePath: string, content = ''): FileDescriptor {
  return { filePath, content };
}

function makeStubAdapter(id: string, predicate: (file: FileDescriptor) => boolean): FileMutationAdapter {
  return {
    id,
    supports: predicate,
    parse: (file) => ({ filePath: file.filePath, value: file.content }),
    normalize: (request) => ({
      requestId: request.requestId,
      actorId: request.actorId,
      filePath: request.filePath,
      op: request.op,
      target: request.target,
      value: request.value
    }),
    getConflictKeys: () => [],
    canMerge: () => ({
      schemaId: 'atm.mergeDecision.v1',
      specVersion: '0.1.0',
      migration: brokerAdapterMigration(),
      verdict: 'mergeable',
      reason: 'stub',
      conflictKeys: []
    }),
    merge: (_mutations, parsed) => parsed,
    serialize: (parsed) => String(parsed.value ?? '')
  };
}

function testRegisteredAdapterResolves() {
  const adapter = makeStubAdapter('only-foo', (file) => file.filePath.endsWith('.foo'));
  const registry = createAdapterRegistry([adapter]);
  const resolved = resolveAdapter(registry, makeFile('thing.foo'));
  assert.equal(resolved.id, 'only-foo');
  console.log('ok: registered adapter resolves for a supported file');
}

function testUnsupportedFallsThroughToFallback() {
  const adapter = makeStubAdapter('only-foo', (file) => file.filePath.endsWith('.foo'));
  const registry = createAdapterRegistry([adapter]);
  const resolved = resolveAdapter(registry, makeFile('thing.unknown'));
  assert.equal(resolved.id, FALLBACK_ADAPTER_ID);
  console.log('ok: unsupported file falls through to the fallback adapter');
}

function testFallbackAlwaysPresentAndLast() {
  const registry = defaultAdapterRegistry();
  assert.equal(registry.fallback.id, FALLBACK_ADAPTER_ID);
  assert.ok(registry.adapters.every((adapter) => adapter.id !== FALLBACK_ADAPTER_ID), 'fallback must not be in the ordered list');
  // The fallback always matches, so an arbitrary unknown file resolves to it.
  const resolved = resolveAdapter(registry, makeFile('mystery.xyz'));
  assert.equal(resolved.id, FALLBACK_ADAPTER_ID);
  console.log('ok: fallback always present and resolved last');
}

function testRegisterAdapterDedupesById() {
  const first = makeStubAdapter('dup', () => false);
  const second = makeStubAdapter('dup', (file) => file.filePath.endsWith('.dup'));
  let registry = createAdapterRegistry([first]);
  registry = registerAdapter(registry, second);
  assert.equal(registry.adapters.filter((adapter) => adapter.id === 'dup').length, 1, 'dedupe by id keeps a single entry');
  // The replacement (which supports .dup) should be the one in effect.
  assert.equal(resolveAdapter(registry, makeFile('x.dup')).id, 'dup');
  // Fallback stays last and intact.
  assert.equal(registry.fallback.id, FALLBACK_ADAPTER_ID);
  assert.ok(registry.adapters.every((adapter) => adapter.id !== FALLBACK_ADAPTER_ID));
  console.log('ok: registerAdapter dedupes by id and keeps fallback last');
}

function testDefaultRegistryOrderNumericBeforeJson() {
  const registry = defaultAdapterRegistry();
  // A *.scalars.json file must resolve to numeric-scalar, not the generic json-record.
  assert.equal(resolveAdapter(registry, makeFile('metrics.scalars.json')).id, 'numeric-scalar');
  // A plain .json file resolves to json-record.
  assert.equal(resolveAdapter(registry, makeFile('data.json')).id, 'json-record');
  // A .md file resolves to text-range.
  assert.equal(resolveAdapter(registry, makeFile('notes.md')).id, 'text-range');
  console.log('ok: default registry order keeps numeric-scalar ahead of json-record');
}

testRegisteredAdapterResolves();
testUnsupportedFallsThroughToFallback();
testFallbackAlwaysPresentAndLast();
testRegisterAdapterDedupesById();
testDefaultRegistryOrderNumericBeforeJson();

console.log('all adapter-registry tests passed');

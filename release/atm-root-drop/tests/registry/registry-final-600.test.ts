import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const registryRoot = path.join(repoRoot, 'packages/core/src/registry');
const ownerShardPath = path.join(repoRoot, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-core.json');

const files = [
  'registry.ts',
  'registry/types.ts',
  'registry/paths.ts',
  'registry/entry.ts',
  'registry/document.ts',
  'registry/drift.ts',
  'registry/validation.ts'
];

for (const relativePath of files) {
  const absolutePath = path.join(registryRoot, relativePath);
  assert.equal(existsSync(absolutePath), true, `${relativePath} should exist`);
  const lineCount = readFileSync(absolutePath, 'utf8').split(/\r?\n/).length;
  assert.ok(lineCount < 600, `${relativePath} has ${lineCount} lines; expected < 600`);
}

const facade = readFileSync(path.join(registryRoot, 'registry.ts'), 'utf8');
for (const expectedExport of [
  'createAtomicRegistryEntry',
  'createRegistryDocument',
  'writeRegistryArtifacts',
  'validateRegistryDocument',
  'validateRegistryDocumentFile',
  'evaluateRegistryEntryDrift'
]) {
  assert.ok(facade.includes(expectedExport), `registry facade should export ${expectedExport}`);
}

const ownerShard = JSON.parse(readFileSync(ownerShardPath, 'utf8')) as { mappings?: Array<{ path_pattern?: string; atom_id?: string }> };
const patterns = new Set((ownerShard.mappings ?? [])
  .filter((entry) => entry.atom_id === 'atom-core-registry')
  .map((entry) => entry.path_pattern));

assert.ok(patterns.has('packages/core/src/registry/registry.ts'), 'owner shard should cover registry facade');
assert.ok(patterns.has('packages/core/src/registry/registry/**/*.ts'), 'owner shard should cover registry split modules');

console.log('[registry-final-600:registry-test] ok');

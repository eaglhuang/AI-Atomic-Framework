import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const maxLines = 600;
const sourceFiles = [
  'scripts/capture-broker-evidence.ts',
  ...readdirSync(path.join(root, 'scripts', 'capture-broker-evidence'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => `scripts/capture-broker-evidence/${entry.name}`)
    .sort()
];

for (const relativePath of sourceFiles) {
  const absolutePath = path.join(root, relativePath);
  assert.equal(existsSync(absolutePath), true, `${relativePath} should exist`);
  const text = readFileSync(absolutePath, 'utf8');
  const lineCount = text.split(/\r?\n/).length - (text.endsWith('\n') ? 1 : 0);
  assert.ok(lineCount <= maxLines, `${relativePath} has ${lineCount} lines, over ${maxLines}`);
}

const shardPath = path.join(root, 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map-shards', 'owner-shard-scripts.json');
const shard = JSON.parse(readFileSync(shardPath, 'utf8')) as {
  mappings?: Array<{ path_pattern?: string; atom_id?: string; source_task?: string }>;
};
const mappings = shard.mappings ?? [];
for (const pathPattern of ['scripts/capture-broker-evidence.ts', 'scripts/capture-broker-evidence/**/*.ts']) {
  const mapping = mappings.find((entry) => entry.path_pattern === pathPattern);
  assert.ok(mapping, `${pathPattern} should be mapped in owner-shard-scripts.json`);
  assert.equal(mapping?.atom_id, 'atm.broker-evidence-capture-map');
  assert.equal(mapping?.source_task, 'TASK-RFT-0060');
}

console.log(`[capture-broker-evidence-final-600] ok (${sourceFiles.length} files)`);

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checkedFiles = [
  'scripts/validate-governance-commands.ts',
  ...listTsFiles(path.join(root, 'scripts/validate-governance-commands'))
    .map((filePath) => path.relative(root, filePath).replace(/\\/g, '/'))
].sort();

function listTsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listTsFiles(fullPath));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}

for (const relativePath of checkedFiles) {
  const lineCount = readFileSync(path.join(root, relativePath), 'utf8').split(/\r?\n/).length;
  assert(lineCount <= 600, `${relativePath} has ${lineCount} physical lines`);
}

const ownerShard = JSON.parse(readFileSync(path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-scripts.json'), 'utf8'));
const patterns = new Set(ownerShard.mappings.map((entry: { path_pattern?: string }) => entry.path_pattern));
assert(patterns.has('scripts/validate-governance-commands.ts'), 'owner shard must retain validate-governance-commands facade ownership');
assert(patterns.has('scripts/validate-governance-commands/**/*.ts'), 'owner shard must cover validate-governance-commands extracted modules');

console.log(`[validate-governance-commands-final-600] ok (${checkedFiles.length} files)`);

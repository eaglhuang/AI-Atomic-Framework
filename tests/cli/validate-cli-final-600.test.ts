import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const maxLines = 600;

function collectTsFiles(relativeDir: string): string[] {
  const absoluteDir = path.join(root, relativeDir);
  const output: string[] = [];
  for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
    const entryPath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      output.push(...collectTsFiles(entryPath));
    } else if (entry.name.endsWith('.ts')) {
      output.push(entryPath.replace(/\\/g, '/'));
    }
  }
  return output;
}

const files = ['scripts/validate-cli.ts', ...collectTsFiles('scripts/validate-cli')];
assert.ok(files.length >= 5, 'validate-cli split should expose facade plus multiple suite modules');

for (const file of files) {
  const lineCount = readFileSync(path.join(root, file), 'utf8').split(/\r?\n/).length;
  assert.ok(lineCount <= maxLines, `${file} has ${lineCount} lines, expected <= ${maxLines}`);
}

const ownerShardPath = path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-scripts.json');
assert.ok(existsSync(ownerShardPath), 'scripts owner shard must exist');
const ownerShard = JSON.parse(readFileSync(ownerShardPath, 'utf8'));
const patterns = new Set(ownerShard.mappings.map((entry: any) => entry.path_pattern));
assert.ok(patterns.has('scripts/validate-cli.ts'), 'owner shard must keep validate-cli facade mapping');
assert.ok(patterns.has('scripts/validate-cli/**/*.ts'), 'owner shard must map validate-cli suite shards');

console.log('[validate-cli-final-600:test] ok');

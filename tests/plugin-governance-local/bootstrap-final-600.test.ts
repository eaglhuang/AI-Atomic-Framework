import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const maxLines = 600;
const bootstrapDir = path.join(root, 'packages/plugin-governance-local/src/bootstrap/bootstrap');
const targets = [
  'packages/plugin-governance-local/src/bootstrap/bootstrap.ts',
  ...collectTypeScriptFiles(bootstrapDir)
    .map((filePath) => path.relative(root, filePath).replace(/\\/g, '/'))
].sort();

const ownerShard = JSON.parse(readFileSync(
  path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-plugins.json'),
  'utf8'
));
const mappedPatterns = new Set(ownerShard.mappings.map((entry: { path_pattern?: string }) => entry.path_pattern));
const failures: string[] = [];

for (const relativePath of targets) {
  const lineCount = readFileSync(path.join(root, relativePath), 'utf8').split(/\r?\n/).length - 1;
  if (lineCount > maxLines) {
    failures.push(`${relativePath} has ${lineCount} lines, over ${maxLines}`);
  }
}

for (const requiredPattern of [
  'packages/plugin-governance-local/src/bootstrap/bootstrap.ts',
  'packages/plugin-governance-local/src/bootstrap/bootstrap/**/*.ts'
]) {
  if (!mappedPatterns.has(requiredPattern)) {
    failures.push(`owner shard missing mapping for ${requiredPattern}`);
  }
}

if (failures.length > 0) {
  throw new Error(`bootstrap final-600 check failed:\n${failures.join('\n')}`);
}

process.stdout.write(`[bootstrap-final-600] ok (${targets.length} files)\n`);

function collectTypeScriptFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const absolutePath = path.join(dir, entry);
    if (statSync(absolutePath).isDirectory()) {
      files.push(...collectTypeScriptFiles(absolutePath));
    } else if (entry.endsWith('.ts')) {
      files.push(absolutePath);
    }
  }
  return files;
}

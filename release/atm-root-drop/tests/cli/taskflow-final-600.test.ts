import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const maxLines = 600;
const taskflowDir = path.join(root, 'packages', 'cli', 'src', 'commands', 'taskflow');
const targets = [
  'packages/cli/src/commands/taskflow.ts',
  ...collectTypeScriptFiles(taskflowDir)
    .map((filePath) => path.relative(root, filePath).replace(/\\/g, '/'))
];

const ownerShardPath = path.join(
  root,
  'atomic_workbench',
  'atomization-coverage',
  'path-to-atom-map-shards',
  'owner-shard-cli.json'
);
const ownerShard = JSON.parse(readFileSync(ownerShardPath, 'utf8'));
const mappedPatterns = new Set(ownerShard.mappings.map((entry: any) => entry.path_pattern));
const failures: string[] = [];

for (const relativePath of targets) {
  const absolutePath = path.join(root, relativePath);
  const lineCount = readFileSync(absolutePath, 'utf8').split(/\r?\n/).length - 1;
  if (lineCount > maxLines) {
    failures.push(`${relativePath} has ${lineCount} lines, over ${maxLines}`);
  }
}

for (const requiredPattern of [
  'packages/cli/src/commands/taskflow.ts',
  'packages/cli/src/commands/taskflow/**/*.ts'
]) {
  if (!mappedPatterns.has(requiredPattern)) {
    failures.push(`owner shard missing mapping for ${requiredPattern}`);
  }
}

if (failures.length > 0) {
  throw new Error(`taskflow final-600 check failed:\n${failures.join('\n')}`);
}

process.stdout.write(`[taskflow-final-600] ok (${targets.length} files)\n`);

function collectTypeScriptFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const absolutePath = path.join(dir, entry);
    if (statSync(absolutePath).isDirectory()) {
      files.push(...collectTypeScriptFiles(absolutePath));
      continue;
    }
    if (entry.endsWith('.ts')) {
      files.push(absolutePath);
    }
  }
  return files.sort();
}

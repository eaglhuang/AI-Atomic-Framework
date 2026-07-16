import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const maxLines = 600;

function countLines(relativePath: string): number {
  const text = readFileSync(path.join(repoRoot, relativePath), 'utf8');
  return text.split(/\r?\n/).length;
}

function listTypeScriptFiles(relativeDir: string): string[] {
  const absoluteDir = path.join(repoRoot, relativeDir);
  const files: string[] = [];
  for (const entry of readdirSync(absoluteDir)) {
    const absolutePath = path.join(absoluteDir, entry);
    const relativePath = path.join(relativeDir, entry).replace(/\\/g, '/');
    if (statSync(absolutePath).isDirectory()) {
      files.push(...listTypeScriptFiles(relativePath));
      continue;
    }
    if (entry.endsWith('.ts')) {
      files.push(relativePath);
    }
  }
  return files;
}

const parserFiles = [
  'packages/cli/src/commands/tasks/task-option-parsers.ts',
  ...listTypeScriptFiles('packages/cli/src/commands/tasks/task-option-parsers')
].sort();

for (const file of parserFiles) {
  const lines = countLines(file);
  assert.ok(lines <= maxLines, `${file} has ${lines} lines; expected <= ${maxLines}`);
}

const ownerShard = JSON.parse(
  readFileSync(
    path.join(repoRoot, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json'),
    'utf8'
  )
) as { mappings?: Array<{ path_pattern?: string; atom_id?: string; source_task?: string }> };

const mappings = ownerShard.mappings ?? [];
for (const pathPattern of [
  'packages/cli/src/commands/tasks/task-option-parsers.ts',
  'packages/cli/src/commands/tasks/task-option-parsers/**/*.ts'
]) {
  const mapping = mappings.find((entry) => entry.path_pattern === pathPattern);
  assert.equal(mapping?.atom_id, 'atm.task-option-parsers-map', `${pathPattern} should map to atm.task-option-parsers-map`);
  assert.equal(mapping?.source_task, 'TASK-RFT-0061', `${pathPattern} should record TASK-RFT-0061`);
}

console.log(`[task-option-parsers-final-600] ok (${parserFiles.length} files)`);

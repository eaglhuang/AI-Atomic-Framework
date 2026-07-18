import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  'packages/cli/src/commands/tasks/close-orchestrator.ts',
  'packages/cli/src/commands/tasks/close-orchestrator/historical-context.ts',
  'packages/cli/src/commands/tasks/close-orchestrator/closure-packet.ts',
  'packages/cli/src/commands/tasks/close-orchestrator/close-result.ts',
  'packages/cli/src/commands/tasks/close-orchestrator/close-write.ts'
];

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function lineCount(source: string): number {
  return source.split(/\r?\n/).filter((_, index, lines) => index < lines.length - 1 || lines[index] !== '').length;
}

for (const file of files) {
  assert.ok(existsSync(path.join(root, file)), `${file} must exist`);
  assert.ok(lineCount(read(file)) <= 600, `${file} must stay at or below 600 lines`);
}

const facade = read('packages/cli/src/commands/tasks/close-orchestrator.ts');
assert.match(facade, /export async function runTasksClose/, 'close orchestrator must keep runTasksClose public surface');
for (const helper of ['historical-context', 'closure-packet', 'close-result', 'close-write']) {
  assert.ok(
    facade.includes(`./close-orchestrator/${helper}.ts`),
    `close orchestrator facade must delegate to ${helper}`
  );
}

const ownerShard = JSON.parse(read('atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json'));
const mappings = ownerShard.mappings as Array<{ path_pattern?: string; atom_id?: string; source_task?: string }>;
for (const pathPattern of [
  'packages/cli/src/commands/tasks/close-orchestrator.ts',
  'packages/cli/src/commands/tasks/close-orchestrator/**/*.ts'
]) {
  const mapping = mappings.find((entry) => entry.path_pattern === pathPattern);
  assert.equal(mapping?.atom_id, 'atm.taskflow-close-orchestrator-map', `${pathPattern} must map to close orchestrator atom map`);
  assert.equal(mapping?.source_task, 'TASK-RFT-0077', `${pathPattern} must record TASK-RFT-0077`);
}

console.log(`close orchestrator final-600 guard passed for ${files.length} files`);

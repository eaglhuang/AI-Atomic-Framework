import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const files = [
  'packages/cli/src/commands/tasks/legacy-impl.ts',
  'packages/cli/src/commands/tasks/legacy/implementation.ts'
];

for (const file of files) {
  const absolute = path.join(root, file);
  assert.equal(existsSync(absolute), true, `${file} should exist`);
  const lines = readFileSync(absolute, 'utf8').split(/\r?\n/).filter((line) => line.length > 0).length;
  assert.ok(lines <= 600, `${file} should stay at or below 600 non-empty lines; got ${lines}`);
}

const facade = readFileSync(path.join(root, 'packages/cli/src/commands/tasks/legacy-impl.ts'), 'utf8');
assert.match(facade, /from '\.\/legacy\/implementation\.ts'/);

const implementation = await import('../../packages/cli/src/commands/tasks/legacy-impl.ts') as Record<string, unknown>;
for (const exportName of [
  'runTasks',
  'parsePlanMarkdown',
  'parseImportOptions',
  'runTasksClose',
  'runTasksImport',
  'runTasksVerify'
]) {
  assert.equal(typeof implementation[exportName], 'function', `${exportName} should remain exported from the facade`);
}

const atomMap = JSON.parse(readFileSync(path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json'), 'utf8'));
const mappings = Array.isArray(atomMap.mappings) ? atomMap.mappings : [];
const mappedPaths = new Set(mappings.map((entry: { path_pattern?: unknown }) => String(entry.path_pattern ?? '')));
assert.ok(mappedPaths.has('packages/cli/src/commands/tasks/legacy-impl.ts'), 'tasks legacy facade should be mapped in owner-shard-cli');
assert.ok(mappedPaths.has('packages/cli/src/commands/tasks/legacy/implementation.ts'), 'tasks legacy implementation should be mapped in owner-shard-cli');

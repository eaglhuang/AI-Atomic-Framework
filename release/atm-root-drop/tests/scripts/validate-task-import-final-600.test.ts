import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const moduleDir = path.join(root, 'scripts/validate-task-import');
const checkedFiles = [
  'scripts/validate-task-import.ts',
  ...readdirSync(moduleDir)
    .filter((entry) => entry.endsWith('.ts'))
    .sort()
    .map((entry) => `scripts/validate-task-import/${entry}`)
];

for (const file of checkedFiles) {
  const lineCount = readFileSync(path.join(root, file), 'utf8').trimEnd().split(/\r?\n/).length;
  if (lineCount > 600) {
    throw new Error(`${file} must stay below 600 lines, got ${lineCount}`);
  }
}

const facade = readFileSync(path.join(root, 'scripts/validate-task-import.ts'), 'utf8');
if (!facade.includes("import { main } from './validate-task-import/suite.ts';")) {
  throw new Error('validate-task-import facade must delegate to the extracted suite module');
}

const ownerShard = readFileSync(
  path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-scripts.json'),
  'utf8'
);
for (const requiredPattern of [
  '"path_pattern": "scripts/validate-task-import.ts"',
  '"path_pattern": "scripts/validate-task-import/**/*.ts"',
  '"atom_id": "atm.task-import-validator-map"'
]) {
  if (!ownerShard.includes(requiredPattern)) {
    throw new Error(`owner shard must register ${requiredPattern}`);
  }
}

console.log('[validate-task-import-final-600] ok');

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const moduleDir = path.join(root, 'scripts/collect-broker-evidence');
const checkedFiles = [
  'scripts/collect-broker-evidence.ts',
  ...readdirSync(moduleDir)
    .filter((entry) => entry.endsWith('.ts'))
    .sort()
    .map((entry) => `scripts/collect-broker-evidence/${entry}`)
];

for (const file of checkedFiles) {
  const lineCount = readFileSync(path.join(root, file), 'utf8').trimEnd().split(/\r?\n/).length;
  if (lineCount > 600) {
    throw new Error(`${file} must stay below 600 lines, got ${lineCount}`);
  }
}

const facade = readFileSync(path.join(root, 'scripts/collect-broker-evidence.ts'), 'utf8');
if (!facade.includes("import { main } from './collect-broker-evidence/main.ts';")) {
  throw new Error('collect-broker-evidence facade must delegate to the extracted main module');
}

const ownerShard = readFileSync(
  path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-scripts.json'),
  'utf8'
);
for (const requiredPattern of [
  '"path_pattern": "scripts/collect-broker-evidence.ts"',
  '"path_pattern": "scripts/collect-broker-evidence/**/*.ts"',
  '"atom_id": "atm.broker-evidence-capture-map"'
]) {
  if (!ownerShard.includes(requiredPattern)) {
    throw new Error(`owner shard must register ${requiredPattern}`);
  }
}

console.log('[collect-broker-evidence-final-600] ok');

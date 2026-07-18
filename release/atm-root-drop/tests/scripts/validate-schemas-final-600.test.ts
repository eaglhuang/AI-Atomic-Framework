import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const helperDir = path.join(root, 'scripts/validate-schemas');
const files = [
  'scripts/validate-schemas.ts',
  ...fs.readdirSync(helperDir)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => `scripts/validate-schemas/${entry}`)
];

for (const file of files) {
  const lineCount = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/).length;
  assert.ok(lineCount <= 600, `${file} has ${lineCount} lines; expected <= 600`);
}

const facade = fs.readFileSync(path.join(root, 'scripts/validate-schemas.ts'), 'utf8');
assert.match(facade, /from '\.\/validate-schemas\/core-contracts\.ts'/);
assert.match(facade, /from '\.\/validate-schemas\/broker-team-contracts\.ts'/);
assert.match(facade, /from '\.\/validate-schemas\/fixtures-and-protection\.ts'/);

const ownerShard = JSON.parse(fs.readFileSync(
  path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-scripts.json'),
  'utf8'
));
const mappings = ownerShard.mappings ?? [];
assert.ok(mappings.some((entry: { path_pattern?: string; atom_id?: string; source_task?: string }) =>
  entry.path_pattern === 'scripts/validate-schemas.ts'
  && entry.atom_id === 'atm.validate-schemas-script-map'
  && entry.source_task === 'TASK-RFT-0075'
));
assert.ok(mappings.some((entry: { path_pattern?: string; atom_id?: string; source_task?: string }) =>
  entry.path_pattern === 'scripts/validate-schemas/**/*.ts'
  && entry.atom_id === 'atm.validate-schemas-script-map'
  && entry.source_task === 'TASK-RFT-0075'
));

console.log(`validate-schemas final-600 guard passed for ${files.length} files`);

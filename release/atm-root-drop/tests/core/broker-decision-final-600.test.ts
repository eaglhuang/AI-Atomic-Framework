import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const files = [
  'packages/core/src/broker/decision.ts',
  ...fs.readdirSync(path.join(root, 'packages/core/src/broker/decision'))
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => `packages/core/src/broker/decision/${entry}`)
];

for (const file of files) {
  const lineCount = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/).length;
  assert.ok(lineCount <= 600, `${file} has ${lineCount} lines; expected <= 600`);
}

const facade = fs.readFileSync(path.join(root, 'packages/core/src/broker/decision.ts'), 'utf8');
assert.match(facade, /export function calculateBrokerDecision/);
assert.match(facade, /from '\.\/decision\/admission\.ts'/);
assert.match(facade, /from '\.\/decision\/decomposition\.ts'/);
assert.match(facade, /from '\.\/decision\/physical-overlap\.ts'/);
assert.match(facade, /from '\.\/decision\/proposal-overlap\.ts'/);

const ownerShard = JSON.parse(fs.readFileSync(
  path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-core.json'),
  'utf8'
));
const mappings = ownerShard.mappings ?? [];
assert.ok(mappings.some((entry: { path_pattern?: string; atom_id?: string; source_task?: string }) =>
  entry.path_pattern === 'packages/core/src/broker/decision.ts'
  && entry.atom_id === 'atom-core-broker'
  && entry.source_task === 'TASK-RFT-0072'
));
assert.ok(mappings.some((entry: { path_pattern?: string; atom_id?: string; source_task?: string }) =>
  entry.path_pattern === 'packages/core/src/broker/decision/**/*.ts'
  && entry.atom_id === 'atom-core-broker'
  && entry.source_task === 'TASK-RFT-0072'
));

console.log(`broker decision final-600 guard passed for ${files.length} files`);

import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const helperDir = path.join(root, 'packages/cli/src/commands/atm-chart');
const files = [
  'packages/cli/src/commands/atm-chart.ts',
  ...fs.readdirSync(helperDir)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => `packages/cli/src/commands/atm-chart/${entry}`)
];

for (const file of files) {
  const lineCount = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/).length;
  assert.ok(lineCount <= 600, `${file} has ${lineCount} lines; expected <= 600`);
}

const facade = fs.readFileSync(path.join(root, 'packages/cli/src/commands/atm-chart.ts'), 'utf8');
assert.match(facade, /export async function runATMChart/);
assert.match(facade, /from '\.\/atm-chart\/render-verify\.ts'/);
assert.match(facade, /from '\.\/atm-chart\/compatibility\.ts'/);
assert.match(facade, /from '\.\/atm-chart\/constants\.ts'/);

const ownerShard = JSON.parse(fs.readFileSync(
  path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json'),
  'utf8'
));
const mappings = ownerShard.mappings ?? [];
assert.ok(mappings.some((entry: { path_pattern?: string; atom_id?: string; source_task?: string }) =>
  entry.path_pattern === 'packages/cli/src/commands/atm-chart.ts'
  && entry.atom_id === 'atom-cli-atm-chart'
  && entry.source_task === 'TASK-RFT-0073'
));
assert.ok(mappings.some((entry: { path_pattern?: string; atom_id?: string; source_task?: string }) =>
  entry.path_pattern === 'packages/cli/src/commands/atm-chart/**/*.ts'
  && entry.atom_id === 'atom-cli-atm-chart'
  && entry.source_task === 'TASK-RFT-0073'
));

console.log(`atm-chart final-600 guard passed for ${files.length} files`);

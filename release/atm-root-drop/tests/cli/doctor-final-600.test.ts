import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const helperDir = path.join(root, 'packages/cli/src/commands/doctor');
const files = [
  'packages/cli/src/commands/doctor.ts',
  ...fs.readdirSync(helperDir)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => `packages/cli/src/commands/doctor/${entry}`)
];

for (const file of files) {
  const lineCount = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/).length;
  assert.ok(lineCount <= 600, `${file} has ${lineCount} lines; expected <= 600`);
}

const facade = fs.readFileSync(path.join(root, 'packages/cli/src/commands/doctor.ts'), 'utf8');
assert.equal(facade.trim(), "export { runDoctor } from './doctor/run-doctor.ts';");

const runDoctor = fs.readFileSync(path.join(root, 'packages/cli/src/commands/doctor/run-doctor.ts'), 'utf8');
assert.match(runDoctor, /from '\.\/policy\.ts'/);
assert.match(runDoctor, /from '\.\/lifecycle\.ts'/);
assert.match(runDoctor, /from '\.\/readiness\.ts'/);
assert.match(runDoctor, /from '\.\/utilities\.ts'/);

const ownerShard = JSON.parse(fs.readFileSync(
  path.join(root, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json'),
  'utf8'
));
const mappings = ownerShard.mappings ?? [];
assert.ok(mappings.some((entry: { path_pattern?: string; atom_id?: string; source_task?: string }) =>
  entry.path_pattern === 'packages/cli/src/commands/doctor.ts'
  && entry.atom_id === 'atm.doctor-command-map'
  && entry.source_task === 'TASK-RFT-0076'
));
assert.ok(mappings.some((entry: { path_pattern?: string; atom_id?: string; source_task?: string }) =>
  entry.path_pattern === 'packages/cli/src/commands/doctor/**/*.ts'
  && entry.atom_id === 'atm.doctor-command-map'
  && entry.source_task === 'TASK-RFT-0076'
));

console.log(`doctor final-600 guard passed for ${files.length} files`);

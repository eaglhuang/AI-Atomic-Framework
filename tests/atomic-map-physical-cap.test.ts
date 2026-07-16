import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const maxLines = 600;
const cappedFiles = [
  'atomic_workbench/atomization-coverage/path-to-atom-map.json',
  'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json',
  'atomic_workbench/atomization-coverage/path-to-atom-map-shards/merge.js'
];

for (const relativePath of cappedFiles) {
  const lineCount = readFileSync(relativePath, 'utf8').split(/\r?\n/).length;
  assert.ok(lineCount <= maxLines, `${relativePath} has ${lineCount} physical lines; expected <= ${maxLines}`);
}

const ownerShard = JSON.parse(readFileSync(
  'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json',
  'utf8'
)) as {
  mappings?: Array<{ path_pattern?: string; atom_id?: string; source_task?: string }>;
};

assert.ok(Array.isArray(ownerShard.mappings), 'owner-shard-cli.json must remain a direct JSON reader contract');
assert.ok(
  ownerShard.mappings.some((entry) =>
    entry.path_pattern === 'packages/cli/src/commands/next.ts'
    && entry.atom_id === 'atm.next-command-router-map'
    && entry.source_task === 'TASK-RFT-0049'
  ),
  'owner-shard-cli.json must preserve direct TASK-RFT-0049 next command mapping'
);
assert.ok(
  ownerShard.mappings.some((entry) =>
    entry.path_pattern === 'packages/cli/src/commands/team.ts'
    && entry.atom_id === 'atm.team-command-map'
    && entry.source_task === 'TASK-RFT-0050'
  ),
  'owner-shard-cli.json must preserve direct TASK-RFT-0050 team command mapping'
);

const mergeValidation = spawnSync(process.execPath, [
  'atomic_workbench/atomization-coverage/path-to-atom-map-shards/merge.js',
  '.',
  'validate'
], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 30_000
});

assert.equal(
  mergeValidation.status,
  0,
  `path-to-atom-map shard projection validation failed\nstdout:\n${mergeValidation.stdout}\nstderr:\n${mergeValidation.stderr}`
);

console.log('atomization coverage map physical-cap guard passed');

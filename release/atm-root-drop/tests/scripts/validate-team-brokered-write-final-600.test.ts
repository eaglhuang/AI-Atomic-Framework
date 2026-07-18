import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const facadePath = path.join(repoRoot, 'scripts', 'validate-team-brokered-write.ts');
const moduleDir = path.join(repoRoot, 'scripts', 'validate-team-brokered-write');
const ownerShardPath = path.join(
  repoRoot,
  'atomic_workbench',
  'atomization-coverage',
  'path-to-atom-map-shards',
  'owner-shard-scripts.json'
);

function lineCount(filePath: string) {
  return readFileSync(filePath, 'utf8').split(/\r?\n/).length;
}

const moduleFiles = [
  'context.ts',
  'linkage.ts',
  'main.ts',
  'proposal-flow.ts'
].map((name) => path.join(moduleDir, name));

for (const filePath of [facadePath, ...moduleFiles]) {
  assert.ok(existsSync(filePath), `expected split file to exist: ${filePath}`);
  assert.ok(lineCount(filePath) <= 600, `${path.relative(repoRoot, filePath)} must stay <= 600 lines`);
}

const facadeText = readFileSync(facadePath, 'utf8');
assert.match(facadeText, /validate-team-brokered-write\/main\.ts/, 'facade must delegate to validator main module');
assert.match(facadeText, /runTeamBrokeredWriteValidator/, 'facade must call the public validator runner');

const ownerShard = JSON.parse(readFileSync(ownerShardPath, 'utf8')) as {
  mappings?: Array<{ path_pattern?: string; atom_id?: string; source_task?: string }>;
};
const mappings = ownerShard.mappings ?? [];
for (const pathPattern of ['scripts/validate-team-brokered-write.ts', 'scripts/validate-team-brokered-write/**/*.ts']) {
  const mapping = mappings.find((entry) => entry.path_pattern === pathPattern);
  assert.ok(mapping, `owner shard must map ${pathPattern}`);
  assert.equal(mapping.atom_id, 'atm.team-brokered-write-validator-map', `${pathPattern} atom map mismatch`);
  assert.equal(mapping.source_task, 'TASK-RFT-0065', `${pathPattern} source task mismatch`);
}

console.log('validate-team-brokered-write final-600 guard passed');

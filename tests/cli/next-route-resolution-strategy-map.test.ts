import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const routeFacadePath = path.join(repoRoot, 'packages/cli/src/commands/next/route-resolution.ts');
const routeModuleDir = path.join(repoRoot, 'packages/cli/src/commands/next/route-resolution');
const atomMapPath = path.join(repoRoot, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli-next.json');

function countLines(filePath: string): number {
  return readFileSync(filePath, 'utf8').split(/\r?\n/).length;
}

function listTsFiles(directoryPath: string): readonly string[] {
  return readdirSync(directoryPath)
    .map((entry) => path.join(directoryPath, entry))
    .filter((filePath) => statSync(filePath).isFile() && filePath.endsWith('.ts'))
    .sort();
}

const routeFiles = [routeFacadePath, ...listTsFiles(routeModuleDir)];
for (const filePath of routeFiles) {
  assert.ok(
    countLines(filePath) <= 600,
    `${path.relative(repoRoot, filePath)} must stay at or below 600 lines`
  );
}

const facadeText = readFileSync(routeFacadePath, 'utf8');
for (const moduleName of [
  'intent',
  'runtime',
  'matching',
  'artifact-scope',
  'pending-worktree',
  'task-card-discovery',
  'queue-inspection'
]) {
  assert.match(
    facadeText,
    new RegExp(`route-resolution/${moduleName}\\.ts`),
    `route-resolution facade should expose ${moduleName}`
  );
}

const atomMap = JSON.parse(readFileSync(atomMapPath, 'utf8')) as {
  mappings?: readonly { readonly path_pattern?: string; readonly atom_id?: string; readonly source_task?: string }[];
};
const strategyMapping = atomMap.mappings?.find((mapping) =>
  mapping.path_pattern === 'packages/cli/src/commands/next/route-resolution/**/*.ts'
);
assert.equal(strategyMapping?.atom_id, 'atm.next-route-resolution-strategy-map');
assert.equal(strategyMapping?.source_task, 'TASK-RFT-0047');

console.log('next route-resolution strategy map guard passed');

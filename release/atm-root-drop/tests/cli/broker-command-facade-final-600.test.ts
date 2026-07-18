import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const facadePath = path.join(repoRoot, 'packages/cli/src/commands/broker.ts');
const moduleDir = path.join(repoRoot, 'packages/cli/src/commands/broker');
const atomMapPath = path.join(repoRoot, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json');

function countLines(filePath: string): number {
  return readFileSync(filePath, 'utf8').split(/\r?\n/).length;
}

function listTsFiles(directoryPath: string): readonly string[] {
  return readdirSync(directoryPath)
    .map((entry) => path.join(directoryPath, entry))
    .filter((filePath) => statSync(filePath).isFile() && filePath.endsWith('.ts'))
    .sort();
}

const brokerFiles = [facadePath, ...listTsFiles(moduleDir)];
for (const filePath of brokerFiles) {
  assert.ok(
    countLines(filePath) <= 600,
    `${path.relative(repoRoot, filePath)} must stay at or below 600 lines`
  );
}

const facadeText = readFileSync(facadePath, 'utf8');
assert.match(
  facadeText,
  /export \{ runBroker \} from '\.\/broker\/implementation\.ts';/,
  'broker facade should delegate to the extracted implementation module'
);

const atomMap = JSON.parse(readFileSync(atomMapPath, 'utf8')) as {
  mappings?: readonly { readonly path_pattern?: string; readonly atom_id?: string; readonly source_task?: string }[];
};
const moduleMapping = atomMap.mappings?.find((mapping) =>
  mapping.path_pattern === 'packages/cli/src/commands/broker/**/*.ts'
);
assert.equal(moduleMapping?.atom_id, 'atm.broker-command-map');
assert.equal(moduleMapping?.source_task, 'TASK-RFT-0051');

const brokerSmoke = spawnSync(process.execPath, [
  'atm.dev.mjs',
  'broker',
  'status',
  '--json'
], {
  cwd: repoRoot,
  encoding: 'utf8'
});
assert.equal(
  brokerSmoke.status,
  0,
  `broker command modules should load through atm.dev.mjs broker status: ${brokerSmoke.stderr || brokerSmoke.stdout}`
);

console.log('broker command facade final-600 guard passed');

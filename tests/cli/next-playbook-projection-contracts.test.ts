import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const facadePath = path.join(repoRoot, 'packages/cli/src/commands/next/playbook-projection.ts');
const moduleDir = path.join(repoRoot, 'packages/cli/src/commands/next/playbook-projection');
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

const projectionFiles = [facadePath, ...listTsFiles(moduleDir)];
for (const filePath of projectionFiles) {
  assert.ok(
    countLines(filePath) <= 600,
    `${path.relative(repoRoot, filePath)} must stay at or below 600 lines`
  );
}

const facadeText = readFileSync(facadePath, 'utf8');
for (const moduleName of [
  'legacy-guidance',
  'task-routing',
  'active-work-summary',
  'channel-playbook',
  'message-assembly',
  'governance-readiness'
]) {
  assert.match(
    facadeText,
    new RegExp(`playbook-projection/${moduleName}\\.ts`),
    `playbook-projection facade should expose ${moduleName}`
  );
}

const atomMap = JSON.parse(readFileSync(atomMapPath, 'utf8')) as {
  mappings?: readonly { readonly path_pattern?: string; readonly atom_id?: string; readonly source_task?: string }[];
};
const moduleMapping = atomMap.mappings?.find((mapping) =>
  mapping.path_pattern === 'packages/cli/src/commands/next/playbook-projection/**/*.ts'
);
assert.equal(moduleMapping?.atom_id, 'atm.next-playbook-projection-contracts');
assert.equal(moduleMapping?.source_task, 'TASK-RFT-0048');

const nextSmoke = spawnSync(process.execPath, [
  'atm.dev.mjs',
  'next',
  '--prompt',
  'TASK-RFT-0048 next playbook projection contract smoke',
  '--json'
], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: { ...process.env, ATM_SKIP_ACTIVE_WORK_SCAN: '1' }
});
assert.equal(
  nextSmoke.status,
  0,
  `playbook projection contract modules should load through atm.dev.mjs next: ${nextSmoke.stderr || nextSmoke.stdout}`
);

console.log('next playbook projection contract guard passed');

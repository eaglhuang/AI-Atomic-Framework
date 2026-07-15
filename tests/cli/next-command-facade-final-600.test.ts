import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';

const lineCount = (filePath: string) => readFileSync(filePath, 'utf8').split(/\r?\n/).length;

function listTypeScriptFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (entry === '__tests__') continue;
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}

const commandFiles = [
  'packages/cli/src/commands/next.ts',
  ...listTypeScriptFiles('packages/cli/src/commands/next')
];

for (const filePath of commandFiles) {
  assert(lineCount(filePath) <= 600, `${filePath} must stay at or below 600 physical lines`);
}

const facade = readFileSync('packages/cli/src/commands/next.ts', 'utf8');
assert.match(facade, /export async function runNext\(/, 'next.ts must keep the public runNext facade');
assert.match(facade, /runNextRoute/, 'next.ts must delegate through the internal route runner');
assert.match(facade, /claimNextImportedTask/, 'next.ts must delegate claim orchestration to a bounded module');

const ownerShard = JSON.parse(readFileSync('atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json', 'utf8')) as {
  mappings: Array<{ path_pattern: string; atom_id: string; source_task?: string }>;
};

for (const pathPattern of [
  'packages/cli/src/commands/next.ts',
  'packages/cli/src/commands/next/**/*.ts'
]) {
  assert(
    ownerShard.mappings.some((entry) =>
      entry.path_pattern === pathPattern
      && entry.atom_id === 'atm.next-command-router-map'
      && entry.source_task === 'TASK-RFT-0049'
    ),
    `${pathPattern} must be mapped to atm.next-command-router-map for TASK-RFT-0049`
  );
}

const smoke = spawnSync(process.execPath, [
  'atm.dev.mjs',
  'next',
  '--prompt',
  'TASK-RFT-0049 facade smoke',
  '--json'
], {
  cwd: process.cwd(),
  encoding: 'utf8',
  timeout: 30_000
});

assert.equal(
  smoke.status,
  0,
  `node atm.dev.mjs next --prompt "TASK-RFT-0049 facade smoke" --json failed\nstdout:\n${smoke.stdout}\nstderr:\n${smoke.stderr}`
);

console.log('next command facade final-600 guard passed');

import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const lineCount = (filePath: string) => readFileSync(filePath, 'utf8').split(/\r?\n/).length;

const extractedFiles = [
  'packages/cli/src/commands/next.ts',
  'packages/cli/src/commands/next/route-resolution.ts',
  'packages/cli/src/commands/next/prompt-results.ts',
  'packages/cli/src/commands/next/playbook-projection.ts'
];

for (const filePath of extractedFiles) {
  assert(
    lineCount(filePath) < 2000,
    `${filePath} must stay below the TASK-RFT-0031 2,000-line split ceiling`
  );
}

const ownerShard = JSON.parse(readFileSync('atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json', 'utf8')) as {
  mappings: Array<{ path_pattern: string; atom_id: string }>;
};

for (const pathPattern of [
  'packages/cli/src/commands/next/route-resolution.ts',
  'packages/cli/src/commands/next/prompt-results.ts',
  'packages/cli/src/commands/next/playbook-projection.ts'
]) {
  assert(
    ownerShard.mappings.some((entry) => entry.path_pattern === pathPattern),
    `${pathPattern} must be covered by the CLI atom map`
  );
}

console.log('next command router extraction checks passed');

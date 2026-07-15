import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';

const maxPhysicalLines = 600;

function lineCount(filePath: string) {
  return readFileSync(filePath, 'utf8').split(/\r?\n/).length;
}

for (const filePath of [
  'packages/cli/src/commands/next/prompt-results.ts',
  'packages/cli/src/commands/next/prompt-result-contracts.ts'
]) {
  assert(
    lineCount(filePath) <= maxPhysicalLines,
    `${filePath} must stay at or below ${maxPhysicalLines} physical lines`
  );
}

const promptResultsSource = readFileSync('packages/cli/src/commands/next/prompt-results.ts', 'utf8');
assert(
  promptResultsSource.includes("from './prompt-result-contracts.ts'"),
  'prompt-results.ts must delegate extracted result contract assembly to prompt-result-contracts.ts'
);

const manifest = JSON.parse(readFileSync('atomic_workbench/atomization-coverage/path-to-atom-map-shards/manifest.json', 'utf8')) as {
  shardPaths: string[];
};
const ownerShardMappings = manifest.shardPaths.flatMap((shardPath) => {
  const shard = JSON.parse(readFileSync(shardPath, 'utf8')) as {
    mappings: Array<{ path_pattern: string; atom_id: string }>;
  };
  assert(
    lineCount(shardPath) <= maxPhysicalLines,
    `${shardPath} must stay at or below ${maxPhysicalLines} physical lines`
  );
  return shard.mappings;
});

assert(
  ownerShardMappings.some((entry) =>
    entry.path_pattern === 'packages/cli/src/commands/next/prompt-result-contracts.ts'
    && entry.atom_id === 'atm.next-prompt-result-contracts'
  ),
  'prompt-result-contracts.ts must be covered by atm.next-prompt-result-contracts in the CLI atom map'
);

console.log('next prompt-results contract extraction checks passed');

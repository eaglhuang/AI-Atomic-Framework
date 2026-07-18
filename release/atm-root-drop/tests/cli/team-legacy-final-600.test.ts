import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const lineLimit = 600;

const legacyRoot = path.join(repoRoot, 'packages/cli/src/commands/team/legacy');
const boundedFiles = [
  'packages/cli/src/commands/team-legacy.ts',
  ...readdirSync(legacyRoot)
    .filter((entry) => entry.endsWith('.ts'))
    .map((entry) => `packages/cli/src/commands/team/legacy/${entry}`)
    .sort()
];

for (const relativePath of boundedFiles) {
  const source = readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const lines = source.split(/\r?\n/).length;
  assert.ok(lines <= lineLimit, `${relativePath} has ${lines} lines; expected <= ${lineLimit}`);
}

const shard = JSON.parse(readFileSync(
  path.join(repoRoot, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json'),
  'utf8'
));
const mappings = Array.isArray(shard.mappings) ? shard.mappings : [];
const mappedPatterns = new Set(mappings.map((entry: { path_pattern?: string }) => entry.path_pattern));

assert.ok(
  mappedPatterns.has('packages/cli/src/commands/team-legacy.ts'),
  'team-legacy facade must have explicit atom-map coverage'
);
assert.ok(
  mappedPatterns.has('packages/cli/src/commands/team/legacy/**/*.ts'),
  'team legacy support modules must have explicit atom-map coverage'
);

console.log('[team-legacy-final-600:test] ok');

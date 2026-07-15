import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const extractedLineLimit = 600;
const legacyPreviousLineCount = 5405;

const extractedFiles = [
  'packages/cli/src/commands/team/legacy/runtime-contracts.ts',
  'packages/cli/src/commands/team/legacy/types.ts'
];

for (const relativePath of extractedFiles) {
  const source = readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const lines = source.split(/\r?\n/).length;
  assert.ok(lines <= extractedLineLimit, `${relativePath} has ${lines} lines; expected <= ${extractedLineLimit}`);
}

const legacySource = readFileSync(path.join(repoRoot, 'packages/cli/src/commands/team-legacy.ts'), 'utf8');
const legacyLines = legacySource.split(/\r?\n/).length;
assert.ok(
  legacyLines < legacyPreviousLineCount,
  `team-legacy.ts should shrink below its TASK-RFT-0029 baseline ${legacyPreviousLineCount}; got ${legacyLines}`
);

const shard = JSON.parse(readFileSync(
  path.join(repoRoot, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json'),
  'utf8'
));
const mappings = Array.isArray(shard.mappings) ? shard.mappings : [];
const mappedPatterns = new Set(mappings.map((entry: { path_pattern?: string }) => entry.path_pattern));

for (const relativePath of extractedFiles) {
  assert.ok(mappedPatterns.has(relativePath), `${relativePath} must have explicit atom-map coverage`);
}

console.log('[team-legacy-command-extraction:test] ok');

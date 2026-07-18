import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const maxLines = 600;
const legacyBaselineLineCount = 5164;

const extractedFiles = [
  'packages/cli/src/commands/team/legacy/runtime-contracts.ts',
  'packages/cli/src/commands/team/legacy/types.ts'
];

function lineCount(relativePath: string): number {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8').split(/\r?\n/).length;
}

for (const relativePath of extractedFiles) {
  assert.ok(lineCount(relativePath) <= maxLines, `${relativePath} must stay at or below ${maxLines} lines`);
}

assert.ok(
  lineCount('packages/cli/src/commands/team-legacy.ts') < legacyBaselineLineCount,
  `team-legacy.ts should shrink below its TASK-RFT-0038 baseline ${legacyBaselineLineCount}`
);

const legacySource = readFileSync(path.join(repoRoot, 'packages/cli/src/commands/team-legacy.ts'), 'utf8');
assert.match(legacySource, /from '\.\/team\/legacy\/runtime-contracts\.ts'/);
assert.doesNotMatch(legacySource, /function normalizeTeamReworkFindings/);

const runtimeContracts = readFileSync(path.join(repoRoot, 'packages/cli/src/commands/team/legacy/runtime-contracts.ts'), 'utf8');
for (const exportName of [
  'buildTeamArtifactHandoffContract',
  'validateTeamArtifactHandoff',
  'buildTeamRetryBudgetContract',
  'buildTeamReworkRouteStateMachine',
  'transitionTeamReworkRoute'
]) {
  assert.match(runtimeContracts, new RegExp(`export function ${exportName}\\b`));
}

const shard = JSON.parse(readFileSync(
  path.join(repoRoot, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json'),
  'utf8'
));
const mappings = Array.isArray(shard.mappings) ? shard.mappings : [];
const mappedPatterns = new Set(mappings.map((entry: { path_pattern?: string }) => entry.path_pattern));

for (const relativePath of extractedFiles) {
  assert.ok(mappedPatterns.has(relativePath), `${relativePath} must have explicit atom-map coverage`);
}

console.log('[team-legacy-runtime-contract-extraction:test] ok');

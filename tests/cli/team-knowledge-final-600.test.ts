import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const lineCount = (filePath: string) => readFileSync(filePath, 'utf8').split(/\r?\n/).length;

function listTypeScriptFiles(root: string): string[] {
  const entries = readdirSync(root);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.ts')) files.push(fullPath);
  }
  return files;
}

const commandFiles = [
  'packages/cli/src/commands/team-knowledge.ts',
  ...listTypeScriptFiles('packages/cli/src/commands/team-knowledge')
];

for (const filePath of commandFiles) {
  assert(lineCount(filePath) <= 600, `${filePath} must stay at or below 600 physical lines`);
}

const facade = readFileSync('packages/cli/src/commands/team-knowledge.ts', 'utf8');
assert.match(facade, /team-knowledge\/main\.ts/, 'team knowledge facade must delegate runTeamKnowledge to the bounded module tree');
assert.match(facade, /team-knowledge\/summary\.ts/, 'team knowledge facade must preserve buildTeamKnowledgeSummary export');
assert.match(facade, /team-knowledge\/types\.ts/, 'team knowledge facade must preserve TeamKnowledgeSummary type export');

const ownerShard = JSON.parse(readFileSync('atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json', 'utf8')) as {
  mappings: Array<{ path_pattern: string; atom_id: string; source_task?: string }>;
};

for (const pathPattern of [
  'packages/cli/src/commands/team-knowledge.ts',
  'packages/cli/src/commands/team-knowledge/**/*.ts'
]) {
  assert(
    ownerShard.mappings.some((entry) =>
      entry.path_pattern === pathPattern
      && entry.atom_id === 'atm.team-knowledge-command-map'
      && entry.source_task === 'TASK-RFT-0064'
    ),
    `${pathPattern} must be mapped to atm.team-knowledge-command-map for TASK-RFT-0064`
  );
}

console.log('team-knowledge final-600 guard passed');

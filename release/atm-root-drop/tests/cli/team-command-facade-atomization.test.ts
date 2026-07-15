import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { teamCommandRegistry } from '../../packages/cli/src/commands/team/command-registry.ts';

const repoRoot = process.cwd();
const lineLimit = 600;

const boundedCommandFiles = [
  'packages/cli/src/commands/team.ts',
  'packages/cli/src/commands/team/command-registry.ts',
  'packages/cli/src/commands/team/plan-command.ts',
  'packages/cli/src/commands/team/start-command.ts',
  'packages/cli/src/commands/team/status-command.ts',
  'packages/cli/src/commands/team/execute-command.ts',
  'packages/cli/src/commands/team/admission-command.ts',
  'packages/cli/src/commands/team/cost-command.ts',
  'packages/cli/src/commands/team/report-command.ts'
];

for (const relativePath of boundedCommandFiles) {
  const source = readFileSync(path.join(repoRoot, relativePath), 'utf8');
  const lines = source.split(/\r?\n/).length;
  assert.ok(lines <= lineLimit, `${relativePath} has ${lines} lines; expected <= ${lineLimit}`);
}

const expectedSubcommands = ['plan', 'start', 'status', 'execute', 'admission', 'validate', 'cost', 'report'];
assert.deepEqual(
  teamCommandRegistry.map((entry) => entry.subcommand),
  expectedSubcommands,
  'team command registry should expose a deterministic subcommand order'
);

for (const entry of teamCommandRegistry) {
  assert.ok(entry.atomId.startsWith('atm.team-'), `${entry.subcommand} must be mapped to an ATM team atom`);
}

const shard = JSON.parse(readFileSync(
  path.join(repoRoot, 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json'),
  'utf8'
));
const mappings = Array.isArray(shard.mappings) ? shard.mappings : [];
const mappedPatterns = new Set(mappings.map((entry: { path_pattern?: string }) => entry.path_pattern));

for (const relativePath of boundedCommandFiles) {
  assert.ok(mappedPatterns.has(relativePath), `${relativePath} must have explicit atom-map coverage`);
}

console.log('[team-command-facade-atomization:test] ok');


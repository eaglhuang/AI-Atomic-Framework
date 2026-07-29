import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  buildCommandManifest,
  inspectCommandExecutability,
  parseAtmCommandToManifest
} from '../../packages/cli/src/commands/shared/command-manifest.ts';
import { buildActiveWorkSummary } from '../../packages/cli/src/commands/next/playbook-projection/active-work-summary.ts';

// A task-scoped status command without --task is not executable (ATM_CLI_USAGE).
const noTaskId = inspectCommandExecutability('node atm.mjs tasks status --json');
assert.equal(noTaskId.ok, false);
assert.equal(noTaskId.taskScoped, true);
assert.ok(noTaskId.reason && noTaskId.reason.includes('--task'));

// The same command with --task <id> is executable.
assert.equal(inspectCommandExecutability('node atm.mjs tasks status --task ATM-GOV-0263 --json').ok, true);
assert.equal(inspectCommandExecutability('node atm.mjs tasks show --task ATM-GOV-0263 --json').ok, true);

// Aggregate status commands need no --task.
for (const aggregate of [
  'node atm.mjs status --json',
  'node atm.mjs broker status --json',
  'node atm.mjs team status --compact --json'
]) {
  assert.equal(inspectCommandExecutability(aggregate).ok, true, `${aggregate} must be executable`);
}

// Non-task-scoped subcommands are unaffected.
assert.equal(inspectCommandExecutability('node atm.mjs next --claim --json').ok, true);
assert.equal(inspectCommandExecutability('node atm.mjs broker runner-sync status --json').ok, true);

// Manifests are shell-less by default and parse round-trip.
const manifest = buildCommandManifest({ argv: ['atm.mjs', 'broker', 'status', '--json'] });
assert.equal(manifest.shell, false);
assert.equal(manifest.executable, 'node');
const parsed = parseAtmCommandToManifest('node atm.mjs tasks status --task ATM-GOV-0263 --json');
assert.equal(parsed.shell, false);
assert.deepEqual(parsed.argv, ['atm.mjs', 'tasks', 'status', '--task', 'ATM-GOV-0263', '--json']);

// Active-work guidance advertises an executable aggregate status command.
const cwd = mkdtempSync(path.join(tmpdir(), 'atm-active-work-'));
try {
  const summary = buildActiveWorkSummary(cwd, 'actor-a', []);
  const statusCommand = summary.brokerRecommendation.statusCommand;
  assert.equal(inspectCommandExecutability(statusCommand).ok, true, `active-work statusCommand must be executable: ${statusCommand}`);
  assert.equal(statusCommand, 'node atm.mjs broker status --json');
  assert.equal(inspectCommandExecutability(summary.brokerRecommendation.brokerStatusCommand).ok, true);
  assert.equal(inspectCommandExecutability(summary.brokerRecommendation.teamStatusCommand).ok, true);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('next-emitted-command-executability.test passed');

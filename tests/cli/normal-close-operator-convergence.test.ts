import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectIntegrationBootstrap } from '../../packages/cli/src/commands/integration/bootstrap.ts';
import { inspectRuntimeAdapterReadiness } from '../../packages/cli/src/commands/runtime-adapter-readiness.ts';
import { buildChannelPlaybook } from '../../packages/cli/src/commands/next/playbook-projection/channel-playbook.ts';
import { buildNextMessages } from '../../packages/cli/src/commands/next/playbook-projection/message-assembly.ts';

const root = mkdtempSync(path.join(tmpdir(), 'atm-normal-close-'));
const integration = inspectIntegrationBootstrap(root);
const runtime = inspectRuntimeAdapterReadiness(root);
rmSync(root, { recursive: true, force: true });

for (const claimActive of [false, true]) {
  const playbook = buildChannelPlaybook({ channel: 'normal', taskId: 'TASK-EXAMPLE-0001', actorPlaceholder: 'example', claimActive, laneSessionId: 'lane-example' });
  const commands = playbook.commandSequence;
  assert.equal(commands.some(command => /(?:^git add\b|\bgit commit\b)/.test(command)), false, 'normal close must not emit a separate delivery commit');
  assert.equal(commands.some(command => /next --claim/.test(command)), !claimActive, 'keep claimed and unclaimed routes distinct');
  assert.match(commands.at(-1) ?? '', /taskflow close .*--lane-session lane-example --write --json$/);
  assert.equal(playbook.governedGitEntrypoint.preferredCommand, commands.at(-1));
  assert.match(playbook.commitTiming, /commits.*deliverables.*governance/i);
  assert.match(playbook.commitTiming, /stage-only/);
  for (const command of commands.filter(command => /(?:evidence run|taskflow)/.test(command))) assert.match(command, /--lane-session lane-example/);
  const messages = buildNextMessages({ status: 'ready', command: 'example', playbook }, null, integration, runtime, { level: 'info', code: 'EXAMPLE', text: 'example', data: {} });
  const reminder = messages.find(entry => entry.code === 'ATM_TASK_CLOSE_REMINDER');
  assert.match(reminder?.text ?? '', /taskflow close --write/);
  assert.doesNotMatch(reminder?.text ?? '', /run tasks close|before committing/);
}

const fast = buildChannelPlaybook({ channel: 'fast', fastClaimActive: true });
assert.match(fast.commandSequence.at(-1) ?? '', /git commit .*--auto-stage/);
assert.equal(fast.commandSequence.some(command => /taskflow close/.test(command)), false);
const batch = buildChannelPlaybook({ channel: 'batch', batchState: 'queue-head-active' });
const checkpoint = batch.commandSequence.findIndex(command => /batch checkpoint/.test(command));
const commit = batch.commandSequence.findIndex(command => /git commit/.test(command));
assert.ok(checkpoint >= 0 && commit > checkpoint, 'batch retains checkpoint-before-commit semantics');
const firstFive = readFileSync(new URL('../../docs/ATM_AI_FIRST_5_MIN.md', import.meta.url), 'utf8');
assert.match(firstFive, /taskflow close --write.*commits/);
assert.doesNotMatch(firstFive, /^- Commit with `node atm\.mjs git commit/m);
console.log('normal close operator convergence: ok');

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBootstrap } from '../../packages/cli/src/commands/bootstrap-entry.ts';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { diagnoseClaimReadinessForTasks } from '../../packages/cli/src/commands/next/claim-readiness.ts';
import { buildPromptRequiredNextResult } from '../../packages/cli/src/commands/next/prompt-guidance-result.ts';
import { buildChannelPlaybook } from '../../packages/cli/src/commands/next/playbook-projection/channel-playbook.ts';
import { buildTaskScopedClaimCommand } from '../../packages/cli/src/commands/next/task-scoped-claim-command.ts';
import { inspectIntegrationBootstrap } from '../../packages/cli/src/commands/integration.ts';
import { inspectRuntimeAdapterReadiness } from '../../packages/cli/src/commands/runtime-adapter-readiness.ts';
import { releaseQuickfixLock } from '../../packages/cli/src/commands/work-channels.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const devCli = path.join(repoRoot, 'atm.dev.mjs');
const COMMAND_KEYS = new Set([
  'command', 'requiredCommand', 'nextStep', 'nextCommand', 'normalClaimCommand', 'taskScopedClaimCommand',
  'preferredCommand', 'checkpointCommand', 'repairCommand', 'batchCheckpointCommand', 'preCloseCommand',
  'dryRunCommand', 'writeCommand', 'installCommand', 'fastClaimCommand'
]);
const GAP_KEYS = new Set(['commandSequence', 'allowedCommands']);
const SKIP_KEYS = new Set([
  'importedTaskQueue', 'selectedTask', 'selectedTasks', 'taskIntent', 'taskDocument', 'tasks',
  'integrationBootstrap', 'runtimeAdapterReadiness', 'frameworkStatus', 'runnerMode', 'candidates', 'decisionTrail',
  'ticketStates'
]);

type PasteRun = { status: number | null; output: string };

function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
}

function toSourceCommand(command: string) {
  return command.replace(/\bnode atm\.mjs\b/g, `node ${JSON.stringify(devCli)}`);
}

function paste(cwd: string, command: string): PasteRun {
  const run = spawnSync('bash', ['-lc', toSourceCommand(command)], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ATM_ACTOR_ID: '', AGENT_IDENTITY: '' },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180000
  });
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  assert.equal(run.error, undefined, `${command}\n${run.error?.message ?? ''}`);
  assert.doesNotMatch(output, /ATM_CLI_USAGE/, `${command}\n${output.slice(0, 2000)}`);
  return { status: run.status, output };
}

function assertNoAngleBrackets(value: unknown) {
  const commands: string[] = [];
  const walk = (node: unknown, key: string | null) => {
    if (typeof node === 'string') {
      if (key && COMMAND_KEYS.has(key)) commands.push(node);
      return;
    }
    if (Array.isArray(node)) {
      if (key && GAP_KEYS.has(key)) {
        for (const entry of node) {
          if (typeof entry === 'string') commands.push(entry);
          else walk(entry, null);
        }
        return;
      }
      for (const entry of node) walk(entry, null);
      return;
    }
    if (!node || typeof node !== 'object') return;
    for (const [childKey, child] of Object.entries(node)) {
      if (SKIP_KEYS.has(childKey)) continue;
      walk(child, childKey);
    }
  };
  walk(value, null);
  for (const command of commands) {
    assert.equal(command.includes('<') || command.includes('>'), false, command);
  }
  return commands;
}

function runnableShellCommands(value: unknown): string[] {
  const commands: string[] = [];
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry);
      return;
    }
    const record = node as Record<string, unknown>;
    for (const [key, child] of Object.entries(record)) {
      if (SKIP_KEYS.has(key)) continue;
      if (typeof child === 'string' && COMMAND_KEYS.has(key) && /^(node|npm|git) /.test(child)) {
        const readyFlag = key === 'command' ? record.pasteReady : record[`${key}Ready`];
        if (readyFlag !== false) commands.push(child);
      } else if (Array.isArray(child) && GAP_KEYS.has(key)) {
        const gapKey = key === 'commandSequence' ? 'unresolvedCommands' : 'unresolvedAllowedCommands';
        const gaps = new Set((Array.isArray(record[gapKey]) ? record[gapKey] as unknown as { index: number }[] : []).map((gap) => gap.index));
        child.forEach((entry, index) => {
          if (typeof entry === 'string' && /^(node|npm|git) /.test(entry) && !gaps.has(index)) commands.push(entry);
          else walk(entry);
        });
      } else {
        walk(child);
      }
    }
  };
  walk(value);
  return [...new Set(commands)];
}

async function makeAdopter() {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-paste-ready-'));
  writeFileSync(path.join(cwd, 'README.md'), '# Paste\n');
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'Paste Test']);
  git(cwd, ['config', 'user.email', 'paste@example.com']);
  await runBootstrap(['--cwd', cwd, '--json']);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init', '--no-verify']);
  return cwd;
}

function claimByPasting(cwd: string, command: string, actorId: string) {
  assert.equal(command.includes('<') || command.includes('>'), false, command);
  assert.match(command, new RegExp(`--actor ${actorId}\\b`));
  assert.doesNotMatch(command, /ATM_ACTOR_ID/);
  const result = paste(cwd, command);
  assert.equal(result.status, 0, result.output.slice(-2500));
  const parsed = JSON.parse(result.output.slice(result.output.indexOf('{'))) as unknown as {
    evidence?: { quickfixLock?: { actorId?: string; status?: string } };
  };
  assert.equal(parsed.evidence?.quickfixLock?.actorId, actorId);
  assert.equal(parsed.evidence?.quickfixLock?.status, 'active');
  assert.ok(releaseQuickfixLock(cwd, actorId));
}

const savedActor = process.env.ATM_ACTOR_ID;
const savedLegacy = process.env.AGENT_IDENTITY;
delete process.env.ATM_ACTOR_ID;
delete process.env.AGENT_IDENTITY;
const cwd = await makeAdopter();
try {
  const promptRequired = buildPromptRequiredNextResult({
    cwd,
    claimRequested: false,
    importedTaskQueue: {
      taskStorePath: '.atm/history/tasks', openTaskCount: 1, selectedTask: null, claimableTask: null, promptScope: null,
      tasks: []
    },
    integrationBootstrap: inspectIntegrationBootstrap(cwd),
    runtimeAdapterReadiness: inspectRuntimeAdapterReadiness(cwd)
  }) as unknown as { evidence: { nextAction: { command: string; pasteReady?: boolean; missing?: string[]; commandTemplate?: string; status: string } } };
  const missingAction = promptRequired.evidence.nextAction;
  assert.equal(missingAction.status, 'prompt-required');
  assert.equal(missingAction.pasteReady, false);
  assert.ok(missingAction.missing?.includes('--prompt'), JSON.stringify(missingAction.missing));
  assert.equal(missingAction.command, missingAction.commandTemplate);
  assert.match(missingAction.command, /"ATM_USER_PROMPT"/);
  assertNoAngleBrackets(promptRequired);
  const filled = paste(cwd, missingAction.command.replaceAll('ATM_USER_PROMPT', 'a bounded smoke task'));
  assert.notEqual(filled.status, null);

  const unknown = await runNext(['--cwd', cwd, '--prompt', 'quick fix: typo in README.md', '--json']) as unknown as {
    messages: { code: string; text: string }[];
    evidence: { nextAction: { status: string; command: string; pasteReady?: boolean; missing?: string[]; commandTemplate?: string; reason: string } };
  };
  const unknownAction = unknown.evidence.nextAction;
  assert.equal(unknownAction.status, 'quickfix-actor-required');
  assert.notEqual(unknownAction.status, 'quickfix-ready');
  assert.equal(unknownAction.pasteReady, false);
  assert.ok(unknownAction.missing?.includes('--actor'), JSON.stringify(unknownAction.missing));
  assert.match(unknownAction.command, /--actor ATM_ACTOR_ID\b/);
  assert.match(unknownAction.reason, /--actor is missing/);
  assert.match(unknown.messages.find((entry) => entry.code === 'ATM_NEXT_QUICKFIX_ROUTE_READY')?.text ?? '', /not ready/);
  assertNoAngleBrackets(unknown);
  for (const command of runnableShellCommands(unknown)) {
    assert.doesNotMatch(command, /next --claim/);
    paste(cwd, command);
  }

  const routes = await runNext(['--cwd', cwd, '--prompt', 'Update the intro in README.md', '--json']) as unknown as {
    evidence: { nextAction: { command: string; suggestedRoutes: { channel: string | null; command: string; pasteReady?: boolean; missing?: string[]; when: string }[] } };
  };
  const fast = routes.evidence.nextAction.suggestedRoutes.find((route) => route.channel === 'fast');
  assert.ok(fast);
  assert.equal(fast.pasteReady, false);
  assert.ok(fast.missing?.includes('--actor'));
  assert.match(fast.when, /not a one-step claim/);
  assert.doesNotMatch(routes.evidence.nextAction.command, /--write/);
  assertNoAngleBrackets(routes);
  const openDryRun = paste(cwd, routes.evidence.nextAction.command);
  assert.equal(openDryRun.status, 0, openDryRun.output.slice(-2000));

  const byFlag = await runNext(['--cwd', cwd, '--actor', 'flag-actor', '--prompt', 'quick fix: typo in README.md', '--json']) as unknown as {
    evidence: { nextAction: { status: string; command: string; pasteReady?: boolean } };
  };
  assert.equal(byFlag.evidence.nextAction.status, 'quickfix-ready');
  assert.notEqual(byFlag.evidence.nextAction.pasteReady, false);
  assertNoAngleBrackets(byFlag);
  claimByPasting(cwd, byFlag.evidence.nextAction.command, 'flag-actor');

  process.env.ATM_ACTOR_ID = 'env-actor';
  const byEnv = await runNext(['--cwd', cwd, '--prompt', 'quick fix: typo in README.md', '--json']) as unknown as {
    evidence: { nextAction: { status: string; command: string; pasteReady?: boolean } };
  };
  delete process.env.ATM_ACTOR_ID;
  assert.equal(byEnv.evidence.nextAction.status, 'quickfix-ready');
  assert.notEqual(byEnv.evidence.nextAction.pasteReady, false);
  claimByPasting(cwd, byEnv.evidence.nextAction.command, 'env-actor');

  mkdirSync(path.join(cwd, '.atm', 'runtime', 'identity'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm', 'runtime', 'identity', 'default.json'), `${JSON.stringify({ actorId: 'identity-actor' })}\n`);
  const byIdentity = await runNext(['--cwd', cwd, '--prompt', 'quick fix: typo in README.md', '--json']) as unknown as {
    evidence: { nextAction: { status: string; command: string; pasteReady?: boolean } };
  };
  rmSync(path.join(cwd, '.atm', 'runtime', 'identity', 'default.json'));
  assert.equal(byIdentity.evidence.nextAction.status, 'quickfix-ready');
  assert.notEqual(byIdentity.evidence.nextAction.pasteReady, false);
  claimByPasting(cwd, byIdentity.evidence.nextAction.command, 'identity-actor');

  const playbook = buildChannelPlaybook({ channel: 'batch', originalPrompt: 'finish the queue', taskId: 'TASK-PASTE-0001' });
  const scoped = buildTaskScopedClaimCommand({ selectedTaskId: 'TASK-PASTE-0001', explicitTaskSelector: null, userPrompt: 'finish the queue' });
  const readiness = diagnoseClaimReadinessForTasks(cwd, [{
    workItemId: 'TASK-PASTE-0001', status: 'open', format: 'json', sourcePlanPath: null
  }], 'write');
  for (const fixture of [playbook, scoped, readiness]) {
    assertNoAngleBrackets(fixture);
    for (const command of runnableShellCommands(fixture)) paste(cwd, command);
  }
} finally {
  if (savedActor === undefined) delete process.env.ATM_ACTOR_ID;
  else process.env.ATM_ACTOR_ID = savedActor;
  if (savedLegacy === undefined) delete process.env.AGENT_IDENTITY;
  else process.env.AGENT_IDENTITY = savedLegacy;
  rmSync(cwd, { recursive: true, force: true });
}

console.log('ok: paste-ready commands execute, and missing data or an unknown actor stays unready');

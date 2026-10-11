import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBootstrap } from '../../packages/cli/src/commands/bootstrap-entry.ts';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { runTaskflow } from '../../packages/cli/src/commands/taskflow.ts';

function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-day1-route-'));
try {
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'N']);
  git(cwd, ['config', 'user.email', 'n@example.com']);
  await runBootstrap(['--cwd', cwd, '--json']);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init', '--no-verify']);

  const guidance = await runNext(['--cwd', cwd, '--prompt', 'Add a note to the project', '--json']) as any;
  const guidanceAction = guidance.evidence.nextAction;
  assert.match(guidanceAction.command, /taskflow open --write/);
  assert.doesNotMatch(JSON.stringify(guidanceAction.suggestedRoutes), /<[^>]+>/);
  assert.equal(guidanceAction.suggestedRoutes.some((route: { channel: string | null }) => route.channel === 'fast'), false);

  const dry = await runTaskflow(['open', '--cwd', cwd, '--dry-run', '--json']) as any;
  assert.notEqual(dry.writeReadinessHint.status, 'ready');
  assert.deepEqual(
    ['--actor', '--scope-path', '--validator'].filter((flag) => dry.writeReadinessHint.missingPrerequisites.includes(flag)),
    ['--actor', '--scope-path', '--validator']
  );

  await assert.rejects(
    () => runTaskflow(['open', '--cwd', cwd, '--write', '--actor', '<id>', '--title', 'Add hello.txt', '--scope-path', 'hello.txt', '--validator', 'test -f hello.txt', '--json']),
    (error: unknown) => (error as { code?: string }).code === 'ATM_CLI_PLACEHOLDER_VALUE'
  );
  await assert.rejects(
    () => runTaskflow(['open', '--cwd', cwd, '--write', '--actor', 'newcomer-ai', '--title', 'Add hello.txt', '--scope-path', 'hello.txt', '--validator', '<command>', '--json']),
    (error: unknown) => (error as { code?: string }).code === 'ATM_CLI_PLACEHOLDER_VALUE'
  );

  const opened = await runTaskflow([
    'open', '--cwd', cwd, '--write', '--actor', 'newcomer-ai',
    '--title', 'Add hello.txt', '--goal', 'Create hello.txt with one line of text.',
    '--scope-path', 'hello.txt', '--validator', 'test -f hello.txt', '--json'
  ]) as any;
  assert.equal(opened.ok, true, JSON.stringify(opened.messages));
  const taskId = opened.evidence.generation.taskId as string;
  const claimed = await runNext(['--cwd', cwd, '--claim', '--actor', 'newcomer-ai', '--task', taskId, '--json']) as any;
  const nextAction = claimed.evidence.nextAction;
  assert.equal(nextAction.command, 'implement-deliverables');
  assert.equal(nextAction.command, nextAction.playbook.commandSequence[0]);
  assert.doesNotMatch(nextAction.command, /\bstart\b/);
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('ok: claim stays on implement-deliverables and empty-queue open routes have no placeholders');

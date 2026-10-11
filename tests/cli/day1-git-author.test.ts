import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBootstrap } from '../../packages/cli/src/commands/bootstrap-entry.ts';
import { runPublicCli } from '../../packages/cli/src/atm-public.ts';
import { runTaskflow } from '../../packages/cli/src/commands/taskflow.ts';
import { inspectTaskflowGitAuthorGap, TASKFLOW_GIT_AUTHOR_MISSING } from '../../packages/cli/src/commands/taskflow/git-author-guard.ts';

function git(cwd: string, args: string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `${args.join(' ')} ${result.stderr}`);
}

const saved = {
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
  GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
  GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
  GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
  GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
  ATM_GIT_NAME: process.env.ATM_GIT_NAME,
  ATM_GIT_EMAIL: process.env.ATM_GIT_EMAIL
};
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-day1-author-'));
try {
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'N']);
  git(cwd, ['config', 'user.email', 'n@example.com']);
  await runBootstrap(['--cwd', cwd, '--json']);
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-qm', 'init', '--no-verify']);
  const opened = await runTaskflow([
    'open', '--cwd', cwd, '--write', '--actor', 'newcomer-ai',
    '--title', 'Add hello.txt', '--goal', 'Create hello.txt',
    '--scope-path', 'hello.txt', '--validator', 'test -f hello.txt', '--json'
  ]) as { ok: boolean; evidence: { generation: { taskId: string } }; messages?: unknown };
  assert.equal(opened.ok, true, JSON.stringify(opened.messages));
  const taskId = opened.evidence.generation.taskId;
  git(cwd, ['config', '--unset', 'user.name']);
  git(cwd, ['config', '--unset', 'user.email']);
  process.env.GIT_CONFIG_GLOBAL = '/dev/null';
  process.env.GIT_CONFIG_SYSTEM = '/dev/null';
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'ATM_GIT_NAME', 'ATM_GIT_EMAIL']) {
    delete process.env[key];
  }

  const gap = inspectTaskflowGitAuthorGap(cwd, 'newcomer-ai');
  assert.ok(gap, 'missing Git author is reported');
  assert.match(gap.requiredCommand, /git config user\.name "Your Name"/);
  assert.match(gap.requiredCommand, /git config user\.email "you@example.com"/);

  const preClose = await runTaskflow(['pre-close', '--cwd', cwd, '--task', taskId, '--actor', 'newcomer-ai', '--json']) as {
    evidence: { historicalClosePreflight: { blockers: Array<{ code: string; requiredCommand: string | null }> } };
  };
  const authorBlocker = preClose.evidence.historicalClosePreflight.blockers.find((entry) => entry.code === TASKFLOW_GIT_AUTHOR_MISSING);
  assert.ok(authorBlocker, JSON.stringify(preClose.evidence.historicalClosePreflight.blockers.map((entry) => entry.code)));
  assert.match(authorBlocker.requiredCommand ?? '', /git config user\.name "Your Name"/);

  let stdout = '';
  let stderr = '';
  const exitCode = await runPublicCli([
    'taskflow', 'close', '--cwd', cwd, '--task', taskId, '--actor', 'newcomer-ai', '--write', '--json'
  ], {
    stdout: { write(value: string) { stdout += value; } },
    stderr: { write(value: string) { stderr += value; } }
  });
  assert.notEqual(exitCode, 0);
  assert.equal(stderr, '', stderr);
  const body = JSON.parse(stdout);
  assert.equal(body.messages[0].code, TASKFLOW_GIT_AUTHOR_MISSING);
  assert.equal(JSON.stringify(body).includes('ATM_CLI_UNHANDLED'), false);
  assert.equal(JSON.stringify(body).includes('Command failed: git commit'), false);
  assert.match(body.messages[0].text, /git config user\.name "Your Name"/);
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(cwd, { recursive: true, force: true });
}

console.log('ok: missing Git author is a structured close blocker');

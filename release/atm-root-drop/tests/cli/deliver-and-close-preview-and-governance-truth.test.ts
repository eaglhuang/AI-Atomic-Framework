import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTasksDeliverAndClose } from '../../packages/cli/src/commands/tasks/deliver-close-orchestrator.ts';
import type { CommandResult } from '../../packages/cli/src/commands/shared.ts';

const TASK = 'TASK-DC-0001';
const ACTOR = 'dc-probe';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function createRepo(): string {
  const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-deliver-close-'));
  git(cwd, ['init', '-q']);
  git(cwd, ['config', 'user.name', 'dc-probe']);
  git(cwd, ['config', 'user.email', 'dc-probe@example.invalid']);
  mkdirSync(path.join(cwd, 'src'), { recursive: true });
  writeFileSync(path.join(cwd, 'src', 'a.txt'), 'delivered\n');
  git(cwd, ['add', '.']);
  git(cwd, ['commit', '-q', '--no-verify', '-m', 'deliver']);
  const now = new Date().toISOString();
  mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${TASK}.json`), `${JSON.stringify({
    taskId: TASK,
    status: 'in-progress',
    claim: { actorId: ACTOR, leaseId: 'lease-dc-1', claimedAt: now, heartbeatAt: now, ttlSeconds: 1800, state: 'active', files: ['src/a.txt'] }
  }, null, 2)}\n`);
  return cwd;
}

function snapshot(cwd: string) {
  return {
    head: git(cwd, ['rev-parse', 'HEAD']),
    index: git(cwd, ['ls-files', '-s']),
    status: git(cwd, ['status', '--porcelain', '--untracked-files=all']),
    task: readFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${TASK}.json`), 'utf8')
  };
}

function recorder(result: Partial<CommandResult>) {
  const calls: string[][] = [];
  const run = async (argv: string[]) => {
    calls.push(argv);
    return { ok: true, messages: [], evidence: {}, ...result } as CommandResult;
  };
  return { calls, run };
}

// T6-2: preview with an existing delivery commit must not reach close or commit.
{
  const cwd = createRepo();
  try {
    const before = snapshot(cwd);
    const tasks = recorder({ ok: false });
    const gitCommit = recorder({ ok: false });
    const result = await runTasksDeliverAndClose(
      ['--cwd', cwd, '--task', TASK, '--actor', ACTOR, '--delivery-commit', 'HEAD', '--dry-run', '--json'],
      { runTasks: tasks.run, runGit: gitCommit.run }
    );
    assert.equal(tasks.calls.length, 0, 'preview must not invoke tasks close');
    assert.equal(gitCommit.calls.length, 0, 'preview must not invoke a governed commit');
    assert.equal(result.ok, true);
    assert.equal((result.evidence as Record<string, unknown>).dryRun, true);
    assert.equal((result.evidence as Record<string, unknown>).deliveryCommitSha, before.head);
    assert.deepEqual(snapshot(cwd), before, 'preview leaves HEAD, index, worktree and task ledger unchanged');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// T6-3: a refused governance commit after a successful close is not overall success.
{
  const cwd = createRepo();
  try {
    const tasks = recorder({ ok: true, evidence: { taskPath: `.atm/history/tasks/${TASK}.json` } });
    const gitCommit = recorder({ ok: false, messages: [] });
    const result = await runTasksDeliverAndClose(
      ['--cwd', cwd, '--task', TASK, '--actor', ACTOR, '--delivery-commit', 'HEAD', '--json'],
      { runTasks: tasks.run, runGit: gitCommit.run }
    );
    assert.equal(tasks.calls.length, 1, 'close runs once');
    assert.equal(tasks.calls[0][0], 'close');
    assert.equal(gitCommit.calls.length, 1, 'the governance commit is attempted once');
    assert.equal(result.ok, false, 'a refused governance commit must not report success');
    const evidence = result.evidence as Record<string, unknown>;
    assert.equal(evidence.phase, 'closed-governance-commit-pending');
    assert.equal(evidence.closureCommitSha, null);
    assert.match(String(evidence.retryGovernanceCommitCommand), /^node atm\.mjs git commit /, 'only the governance commit is left to retry');
    assert.equal(result.messages[0]?.code, 'ATM_DELIVER_AND_CLOSE_GOVERNANCE_COMMIT_PENDING');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

// Non-preview success path is unchanged.
{
  const cwd = createRepo();
  try {
    const tasks = recorder({ ok: true, evidence: { taskPath: `.atm/history/tasks/${TASK}.json` } });
    const gitCommit = recorder({ ok: true, evidence: { commitSha: 'f'.repeat(40) } });
    const result = await runTasksDeliverAndClose(
      ['--cwd', cwd, '--task', TASK, '--actor', ACTOR, '--delivery-commit', 'HEAD', '--json'],
      { runTasks: tasks.run, runGit: gitCommit.run }
    );
    assert.equal(result.ok, true);
    assert.equal((result.evidence as Record<string, unknown>).closureCommitSha, 'f'.repeat(40));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

console.log('ok: deliver-and-close preview has no side effects and a refused governance commit is reported');

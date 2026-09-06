import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { runPreCommitHook } = await import('../../packages/cli/src/commands/hook/pre-commit/implementation.ts');
const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const writeJson = (cwd: string, relative: string, value: unknown) => { const file = path.join(cwd, relative); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); };
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-same-task-context-'));
const taskId = 'TASK-SAME-CONTEXT';
try {
  git(repo, ['init']); git(repo, ['config', 'user.name', 'ATM Test']); git(repo, ['config', 'user.email', 'atm-test@example.invalid']);
  git(repo, ['commit', '--allow-empty', '-m', 'bootstrap']);
  const taskPath = `.atm/history/tasks/${taskId}.json`;
  const eventPath = `.atm/history/task-events/${taskId}/transition-1.json`;
  writeJson(repo, taskPath, { workItemId: taskId, status: 'running', claim: { state: 'active', actorId: 'codex-captain' }, lastTransitionId: 'transition-1' });
  writeJson(repo, eventPath, { schemaId: 'atm.taskTransition.v1', transitionId: 'transition-1', taskId, action: 'claim', actorId: 'codex-captain', taskPath, taskSha256: 'not-used', command: 'node atm.mjs next --claim --json' });
  git(repo, ['add', taskPath, eventPath]);
  const previousActor = process.env.ATM_COMMIT_ACTOR_ID;
  const previousTask = process.env.ATM_COMMIT_TASK_ID;
  try { process.env.ATM_COMMIT_ACTOR_ID = 'codex-captain'; delete process.env.ATM_COMMIT_TASK_ID;
    assert.doesNotThrow(() => runPreCommitHook(repo), 'same-task staged context must not be reported as cross-task');
  } finally { if (previousActor === undefined) delete process.env.ATM_COMMIT_ACTOR_ID; else process.env.ATM_COMMIT_ACTOR_ID = previousActor; if (previousTask === undefined) delete process.env.ATM_COMMIT_TASK_ID; else process.env.ATM_COMMIT_TASK_ID = previousTask; }
  console.log('[pre-commit-same-task-context.test] ok');
} finally { rmSync(repo, { recursive: true, force: true }); }

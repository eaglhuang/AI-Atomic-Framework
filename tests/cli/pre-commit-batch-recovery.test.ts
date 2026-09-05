import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { detectCrossTaskMutation } = await import('../../packages/core/src/broker/cross-task-mutation-guard.ts');

const git = (cwd: string, args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const writeJson = (cwd: string, relative: string, value: unknown) => {
  const file = path.join(cwd, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-batch-recovery-'));
const current = 'TASK-BATCH-CURRENT';
const owner = 'TASK-BATCH-SKIPPED';
const batchId = 'batch-recovery-proof';
const eventPath = `.atm/history/task-events/${owner}/2026-09-06T00-00-00-000Z-batch-skip.json`;
try {
  git(repo, ['init']);
  git(repo, ['config', 'user.name', 'ATM Test']);
  git(repo, ['config', 'user.email', 'atm-test@example.invalid']);
  writeJson(repo, `.atm/history/tasks/${current}.json`, { workItemId: current, status: 'running', claim: { state: 'active', actorId: 'codex-captain' } });
  writeJson(repo, `.atm/history/tasks/${owner}.json`, { workItemId: owner, status: 'planned', claim: { state: 'released', actorId: 'other' } });
  writeJson(repo, `.atm/runtime/batch-runs/${batchId}.json`, { batchId, status: 'active', taskIds: [current, owner] });
  writeJson(repo, eventPath, { schemaId: 'atm.taskTransition.v1', transitionId: 'transition-1', taskId: owner, action: 'batch-skip', actorId: 'codex-captain', batchId, command: `node atm.mjs batch skip --task ${owner} --batch ${batchId} --actor codex-captain --json` });
  git(repo, ['add', eventPath]);
  assert.equal(detectCrossTaskMutation(repo, current, 'pre-commit')?.conflictFiles.length ?? 0, 0, 'official sibling batch skip must be admitted');

  writeJson(repo, eventPath, { schemaId: 'atm.taskTransition.v1', transitionId: 'transition-2', taskId: owner, action: 'batch-skip', actorId: 'codex-captain', batchId: 'batch-not-the-runtime-record', command: 'node atm.mjs batch skip --json' });
  git(repo, ['add', eventPath]);
  assert.ok(detectCrossTaskMutation(repo, current, 'pre-commit'), 'mismatched batch identity must remain blocked');
  console.log('[pre-commit-batch-recovery.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

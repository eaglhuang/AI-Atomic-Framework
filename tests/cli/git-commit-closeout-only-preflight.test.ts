// ATM-BUG-2026-07-07-043 regression test.
//
// A closeout-only claim means "no more source mutation". The governed
// task-scoped git commit lane should reject source changes during bundle
// resolution, before it spends minutes in pre-commit hooks and only then emits
// ATM_PRE_COMMIT_CLOSEOUT_ONLY_CLAIM_MUTATION.
//
// Runnable directly via:
//   node --strip-types tests/cli/git-commit-closeout-only-preflight.test.ts

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveTaskScopedCommitBundle } from '../../packages/cli/src/commands/git-governance.ts';

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-closeout-preflight-'));

try {
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.name', 'ATM Validator']);
  runGit(repo, ['config', 'user.email', 'validator@example.invalid']);

  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src/app.ts'), 'export const value = 1;\n', 'utf8');
  runGit(repo, ['add', '.']);
  runGit(repo, ['commit', '-m', 'bootstrap']);

  const taskId = 'TASK-CLOSEOUT-PREFLIGHT';
  const taskDocument = {
    workItemId: taskId,
    status: 'running',
    claim: {
      actorId: 'closeout-actor',
      leaseId: 'lease-closeout-preflight',
      state: 'active',
      intent: 'closeout-only'
    },
    taskDirectionLock: {
      allowedFiles: ['src/app.ts']
    },
    scopePaths: ['src/app.ts'],
    deliverables: ['src/app.ts'],
    source: {
      planPath: 'docs/tasks/TASK-CLOSEOUT-PREFLIGHT.task.md'
    }
  };
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), taskDocument);

  writeFileSync(path.join(repo, 'src/app.ts'), 'export const value = 2;\n', 'utf8');
  const report = resolveTaskScopedCommitBundle({
    cwd: repo,
    taskId,
    taskDocument,
    apply: true,
    autoStage: true,
    deferForeignStaged: false,
    message: 'feat: should not ship under closeout-only',
    actorId: 'closeout-actor',
    trailers: [`ATM-Actor: closeout-actor`, `ATM-Task: ${taskId}`]
  });

  assert.equal(report.ok, false, 'closeout-only source mutation must fail during commit bundle preflight');
  assert.equal(report.blockedCode, 'ATM_GIT_COMMIT_CLOSEOUT_ONLY_MUTATION');
  assert.deepEqual(report.closeoutOnlyMutationFiles, ['src/app.ts']);
  assert.equal(runGit(repo, ['diff', '--cached', '--name-only']).trim(), '', 'blocked closeout-only preflight must not stage the source mutation');

  console.log('[git-commit-closeout-only-preflight:test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

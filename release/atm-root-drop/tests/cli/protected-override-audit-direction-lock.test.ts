import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { recordProtectedOverrideAuditEvent } from '../../packages/cli/src/commands/emergency/protected-override-audit.ts';
import {
  listTaskOwnedProtectedOverrideAuditFiles,
  resolveTaskScopedCommitBundle
} from '../../packages/cli/src/commands/git-governance.ts';
import { runHook } from '../../packages/cli/src/commands/hook.ts';

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-protected-override-direction-lock-'));
runGit(repo, ['init']);
runGit(repo, ['config', 'user.name', 'ATM Validator']);
runGit(repo, ['config', 'user.email', 'validator@example.invalid']);
runGit(repo, ['commit', '--allow-empty', '-m', 'bootstrap']);

const taskId = 'TASK-DIRECTION-LOCK-117';
const actorId = 'direction-lock-actor';
const scopedFile = 'src/direction-lock.ts';

mkdirSync(path.join(repo, 'src'), { recursive: true });
writeFileSync(path.join(repo, scopedFile), 'export const directionLock = true;\n', 'utf8');

const ownedAudit = recordProtectedOverrideAuditEvent({
  cwd: repo,
  actorId,
  taskId,
  surface: 'git commit --no-verify',
  command: `node atm.mjs git commit --task ${taskId}`,
  flags: ['--no-verify'],
  permission: 'backend.gitHookBypass',
  leaseId: 'lease-direction-lock-117',
  reason: 'direction-lock regression fixture',
  outcome: 'authorized'
});

const foreignAudit = recordProtectedOverrideAuditEvent({
  cwd: repo,
  actorId: 'foreign-actor',
  taskId: 'TASK-FOREIGN-117',
  surface: 'git commit --no-verify',
  command: 'node atm.mjs git commit --task TASK-FOREIGN-117',
  flags: ['--no-verify'],
  permission: 'backend.gitHookBypass',
  leaseId: 'lease-foreign-117',
  reason: 'foreign direction-lock regression fixture',
  outcome: 'authorized'
});

const taskDocument = {
  schemaVersion: 'atm.workItem.v0.2',
  workItemId: taskId,
  status: 'running',
  claim: {
    actorId,
    leaseId: 'lease-direction-lock-117',
    state: 'active',
    files: [scopedFile]
  },
  taskDirectionLock: {
    schemaId: 'atm.taskDirectionLock.v1',
    specVersion: '0.1.0',
    taskId,
    allowedFiles: [scopedFile],
    planningReadOnlyPaths: [],
    planningMirrorPaths: [],
    allowPlanningMirror: false,
    actorId,
    createdAt: '2026-07-14T00:00:00.000Z',
    status: 'active'
  }
};

const admittedAuditPaths = listTaskOwnedProtectedOverrideAuditFiles(repo, taskId);
assert.deepEqual(admittedAuditPaths, [ownedAudit.eventPath], 'declared scope must admit only this task owned audit paths');

const bundle = resolveTaskScopedCommitBundle({
  cwd: repo,
  taskId,
  taskDocument,
  apply: true,
  autoStage: true,
  deferForeignStaged: false,
  message: 'feat: direction-lock audit admission',
  actorId,
  trailers: [`ATM-Actor: ${actorId}`, `ATM-Task: ${taskId}`]
});
assert.equal(bundle.ok, true, `bundle resolution must succeed: ${bundle.blockedSummary ?? bundle.blockedCode ?? ''}`);
assert.ok(
  bundle.commitFiles.includes(ownedAudit.eventPath),
  `task-owned protected audit must be in commit bundle: ${JSON.stringify(bundle.commitFiles)}`
);
assert.ok(
  !bundle.commitFiles.includes(foreignAudit.eventPath),
  'foreign protected audit must stay out of this task commit bundle'
);

mkdirSync(path.join(repo, '.atm/runtime/locks'), { recursive: true });
writeFileSync(path.join(repo, `.atm/runtime/locks/${taskId}.lock.json`), JSON.stringify({
  schemaId: 'atm.governanceScopeLock',
  specVersion: '0.1.0',
  workItemId: taskId,
  lockedBy: actorId,
  actorId,
  leaseId: 'lease-direction-lock-117',
  lockedAt: '2026-07-14T00:00:00.000Z',
  heartbeatAt: '2026-07-14T00:00:00.000Z',
  ttlSeconds: 999999999,
  status: 'active',
  files: [scopedFile],
  taskDirectionLock: taskDocument.taskDirectionLock
}, null, 2), 'utf8');

runGit(repo, ['add', scopedFile, ownedAudit.eventPath]);
const originalActorId = process.env.ATM_COMMIT_ACTOR_ID;
const originalTaskId = process.env.ATM_COMMIT_TASK_ID;
process.env.ATM_COMMIT_ACTOR_ID = actorId;
process.env.ATM_COMMIT_TASK_ID = taskId;
try {
  const hookResult = await runHook(['pre-commit', '--cwd', repo]) as any;
  const blockingCodes = (hookResult.evidence?.blockingFindings ?? []).map((finding: any) => finding.code);
  assert.ok(
    !blockingCodes.includes('ATM_TASK_DIRECTION_SCOPE_DRIFT'),
    `task-owned protected audit must not trip direction-lock drift: ${JSON.stringify(blockingCodes)}`
  );
} finally {
  if (originalActorId === undefined) delete process.env.ATM_COMMIT_ACTOR_ID;
  else process.env.ATM_COMMIT_ACTOR_ID = originalActorId;
  if (originalTaskId === undefined) delete process.env.ATM_COMMIT_TASK_ID;
  else process.env.ATM_COMMIT_TASK_ID = originalTaskId;
}

runGit(repo, ['add', foreignAudit.eventPath]);
const foreignHook = await runHook(['pre-commit', '--cwd', repo]) as any;
const foreignBlockingCodes = (foreignHook.evidence?.blockingFindings ?? []).map((finding: any) => finding.code);
assert.ok(
  foreignBlockingCodes.includes('ATM_TASK_DIRECTION_SCOPE_DRIFT'),
  'arbitrary foreign protected audit must remain fail-closed on direction-lock drift'
);

console.log('[protected-override-audit-direction-lock] ok');

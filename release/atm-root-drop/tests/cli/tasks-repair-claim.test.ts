import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  applyClaimRepairWrite,
  diagnoseClaimRepairState
} from '../../packages/cli/src/commands/tasks/claim-repair-diagnostics.ts';
import { createClaimRecord } from '../../packages/cli/src/commands/tasks/task-ledger-readers.ts';

function makeRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), 'tasks-repair-claim-'));
  mkdirSync(path.join(repo, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.join(repo, '.atm', 'runtime', 'locks'), { recursive: true });
  return repo;
}

function writeTask(repo: string, taskId: string, document: Record<string, unknown>) {
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);
  writeFileSync(taskPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  return taskPath;
}

const repo = makeRepo();
const taskId = 'TASK-MAO-TEST-0043';
const actorId = 'cursor-gpt-5.2';
const nowIso = new Date().toISOString();
const expiredClaim = {
  ...createClaimRecord({
    taskId,
    actorId: 'stale-worker',
    files: ['packages/cli/src/commands/tasks.ts'],
    ttlSeconds: 1,
    timestamp: new Date(Date.now() - 60_000).toISOString()
  }),
  state: 'active' as const
};

writeTask(repo, taskId, {
  schemaVersion: 'atm.workItem.v0.2',
  workItemId: taskId,
  title: 'repair-claim fixture',
  status: 'running',
  owner: 'stale-worker',
  claim: expiredClaim
});

writeFileSync(path.join(repo, '.atm', 'runtime', 'locks', `${taskId}.lock.json`), `${JSON.stringify({
  schemaId: 'atm.governanceScopeLock',
  specVersion: '0.1.0',
  workItemId: taskId,
  lockedBy: 'stale-worker',
  actorId: 'stale-worker',
  lockedAt: nowIso,
  status: 'active',
  files: ['packages/cli/src/commands/tasks.ts'],
  taskDirectionLock: {
    schemaId: 'atm.taskDirectionLock.v1',
    specVersion: '0.1.0',
    taskId,
    actorId: 'stale-worker',
    allowedFiles: ['packages/cli/src/commands/tasks.ts'],
    createdAt: nowIso,
    status: 'active'
  }
}, null, 2)}\n`, 'utf8');

const diagnosis = diagnoseClaimRepairState(repo, taskId, actorId);
assert.equal(diagnosis.blocked, false, 'expired claim must not block repair');
assert.equal(diagnosis.repairable, true, 'expired claim drift must be repairable');
assert.ok(diagnosis.issues.some((entry) => entry.kind === 'expired-claim'), 'must report expired claim');
assert.ok(diagnosis.issues.some((entry) => entry.kind === 'dangling-governance-lock') || diagnosis.issues.some((entry) => entry.kind === 'stale-running-without-claim'), 'must report stale drift');

const taskDocument = JSON.parse(readFileSync(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), 'utf8'));
const applyResult = await applyClaimRepairWrite({
  cwd: repo,
  taskId,
  actorId,
  reason: 'fixture repair',
  taskDocument,
  diagnosis
});
assert.equal(applyResult.after.status, 'ready', 'stale running task must reset to ready');
assert.equal(applyResult.after.claim?.state, 'released', 'expired claim must be released');
assert.ok(applyResult.repairActions.length > 0, 'repair must record actions');

const activeClaim = {
  ...createClaimRecord({
    taskId: `${taskId}-blocked`,
    actorId: 'live-worker',
    files: ['packages/cli/src/commands/tasks.ts'],
    ttlSeconds: 1800,
    timestamp: nowIso
  }),
  state: 'active' as const
};
writeTask(repo, `${taskId}-blocked`, {
  schemaVersion: 'atm.workItem.v0.2',
  workItemId: `${taskId}-blocked`,
  title: 'blocked fixture',
  status: 'running',
  owner: 'live-worker',
  claim: activeClaim
});
const blockedDiagnosis = diagnoseClaimRepairState(repo, `${taskId}-blocked`, actorId);
assert.equal(blockedDiagnosis.blocked, true, 'valid active claim must block repair');
assert.equal(blockedDiagnosis.repairable, false, 'blocked task must not be repairable');
assert.equal(blockedDiagnosis.writeCommand, null, 'blocked task must not expose write command');

rmSync(repo, { recursive: true, force: true });
console.log('[tasks-repair-claim.test] ok');

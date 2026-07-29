import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectClaimDirtyWipAdmission } from '../../packages/cli/src/commands/next/foreign-dirty-wip-admission.ts';
import { applyClaimRepairWrite, diagnoseClaimRepairState } from '../../packages/cli/src/commands/tasks/claim-repair-diagnostics.ts';
import { createClaimRecord } from '../../packages/cli/src/commands/tasks/task-ledger-readers.ts';

const repo = mkdtempSync(path.join(tmpdir(), 'claim-repair-wip-'));
const taskId = 'TASK-WIP-9001';
const ownerActor = 'owner-agent';
const ownerLane = 'lane-owner-9001';
const targetFile = 'packages/cli/src/example.ts';

try {
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'ATM Test'], { cwd: repo });
  mkdirSync(path.join(repo, '.atm', 'history', 'tasks'), { recursive: true });
  mkdirSync(path.dirname(path.join(repo, targetFile)), { recursive: true });
  writeFileSync(path.join(repo, targetFile), 'export const value = 1;\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repo, stdio: 'ignore' });
  writeFileSync(path.join(repo, targetFile), 'export const value = 2;\n', 'utf8');

  const claim = {
    ...createClaimRecord({ taskId, actorId: ownerActor, files: [targetFile], ttlSeconds: 1, timestamp: new Date(Date.now() - 60_000).toISOString() }),
    state: 'active' as const,
    laneSession: {
      laneSessionId: ownerLane,
      status: 'active',
      source: 'fixture',
      exportHint: 'fixture'
    }
  };
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);
  writeFileSync(taskPath, `${JSON.stringify({ workItemId: taskId, status: 'running', owner: ownerActor, claim }, null, 2)}\n`, 'utf8');

  const diagnosis = diagnoseClaimRepairState(repo, taskId, 'repair-operator');
  const repaired = await applyClaimRepairWrite({
    cwd: repo,
    taskId,
    actorId: 'repair-operator',
    reason: 'repair expired claim with dirty WIP',
    taskDocument: JSON.parse(readFileSync(taskPath, 'utf8')),
    diagnosis
  });
  const retention = repaired.taskDocument.wipOwnership as Record<string, unknown>;
  assert.equal(retention.schemaId, 'atm.retainedWipOwnership.v1');
  assert.deepEqual(retention.dirtyPaths, [targetFile]);
  writeFileSync(taskPath, `${JSON.stringify(repaired.taskDocument, null, 2)}\n`, 'utf8');

  const task = { workItemId: taskId } as never;
  const own = inspectClaimDirtyWipAdmission({ cwd: repo, task, actorId: ownerActor, laneSessionId: ownerLane, claimFiles: [targetFile] });
  assert.equal(own.ok, true, 'the retained owner lane must be able to reclaim its dirty WIP');
  const foreign = inspectClaimDirtyWipAdmission({ cwd: repo, task, actorId: 'other-agent', laneSessionId: 'lane-other-9001', claimFiles: [targetFile] });
  assert.equal(foreign.ok, false, 'a different lane must remain blocked by retained WIP ownership');
  assert.equal(foreign.blockers[0]?.ownership, 'foreign');
  console.log('[claim-repair-wip-ownership-continuity.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

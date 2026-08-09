import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectClaimDirtyWipAdmission } from '../foreign-dirty-wip-admission.ts';

const taskId = 'TASK-RETAINED-WIP';
const actorId = 'resume-agent';
const file = 'packages/cli/src/resume.ts';
const repo = mkdtempSync(path.join(tmpdir(), 'atm-retained-wip-admission-'));

function writeJson(relativePath: string, value: unknown) {
  const target = path.join(repo, relativePath);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

try {
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Test'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo, stdio: 'ignore' });
  const target = path.join(repo, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, 'export const state = "base";\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repo, stdio: 'ignore' });
  writeFileSync(target, 'export const state = "retained";\n', 'utf8');

  writeJson(`.atm/history/tasks/${taskId}.json`, {
    workItemId: taskId,
    status: 'ready',
    wipOwnership: {
      schemaId: 'atm.retainedWipOwnership.v1',
      taskId,
      actorId,
      laneSessionId: 'lane-released-owner',
      dirtyPaths: [file]
    }
  });

  const sameTaskFreshLane = inspectClaimDirtyWipAdmission({
    cwd: repo,
    task: { workItemId: taskId } as never,
    actorId,
    laneSessionId: 'lane-fresh-resume',
    claimFiles: [file]
  });
  assert.equal(sameTaskFreshLane.ok, true, 'same task and actor may resume retained WIP from a fresh lane');

  const crossTask = inspectClaimDirtyWipAdmission({
    cwd: repo,
    task: { workItemId: 'TASK-OTHER' } as never,
    actorId,
    laneSessionId: 'lane-fresh-resume',
    claimFiles: [file]
  });
  assert.equal(crossTask.ok, false, 'a different task remains blocked by retained WIP');
  assert.equal(crossTask.blockers[0]?.ownership, 'foreign');

  const crossActor = inspectClaimDirtyWipAdmission({
    cwd: repo,
    task: { workItemId: taskId } as never,
    actorId: 'other-agent',
    laneSessionId: 'lane-fresh-resume',
    claimFiles: [file]
  });
  assert.equal(crossActor.ok, false, 'a different actor remains blocked by retained WIP');

  writeJson(`.atm/history/tasks/${taskId}.json`, {
    workItemId: taskId,
    status: 'running',
    claim: {
      state: 'active',
      actorId,
      leaseId: 'lease-active-owner',
      files: [file],
      laneSession: { laneSessionId: 'lane-active-owner' }
    }
  });
  const activeClaimFreshLane = inspectClaimDirtyWipAdmission({
    cwd: repo,
    task: { workItemId: taskId } as never,
    actorId,
    laneSessionId: 'lane-fresh-resume',
    claimFiles: [file]
  });
  assert.equal(activeClaimFreshLane.ok, false, 'an active claim remains bound to its lane, even for the same task and actor');
  console.log('[foreign-dirty-wip-admission.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

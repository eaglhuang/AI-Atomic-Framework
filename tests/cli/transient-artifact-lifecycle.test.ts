import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCleanup } from '../../packages/cli/src/commands/cleanup/run.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-cleanup-lifecycle-'));
try {
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root });
  const foreign = '.atm/history/evidence/TASK-FOREIGN.runner-sync-receipt.json';
  const foreignAbsolute = path.join(root, foreign);
  mkdirSync(path.dirname(foreignAbsolute), { recursive: true });
  mkdirSync(path.join(root, '.atm/runtime/locks'), { recursive: true });
  writeFileSync(foreignAbsolute, '{"foreign":true}\n');
  writeFileSync(path.join(root, '.atm/runtime/locks/TASK-FOREIGN.lock.json'), JSON.stringify({ workItemId: 'TASK-FOREIGN', actorId: 'other-actor', status: 'active' }));

  const laneSessions = path.join(root, '.atm/runtime/lane-sessions');
  const taskHistory = path.join(root, '.atm/history/tasks');
  mkdirSync(laneSessions, { recursive: true });
  mkdirSync(taskHistory, { recursive: true });
  const expiredLane = '.atm/runtime/lane-sessions/lane-expired-task.json';
  const activeLane = '.atm/runtime/lane-sessions/lane-active-task.json';
  const freshDoneLane = '.atm/runtime/lane-sessions/lane-fresh-done-task.json';
  const malformedLane = '.atm/runtime/lane-sessions/lane-malformed.json';
  writeFileSync(path.join(taskHistory, 'TASK-LANE-DONE.json'), JSON.stringify({ taskId: 'TASK-LANE-DONE', status: 'done' }));
  writeFileSync(path.join(taskHistory, 'TASK-LANE-ACTIVE.json'), JSON.stringify({ taskId: 'TASK-LANE-ACTIVE', status: 'in-progress' }));
  const laneDocument = (laneId: string, taskId: string, status: 'active', expiresAt: string) => ({
    schemaId: 'atm.laneSession.v1',
    laneId,
    actorId: 'agent-lane-owner',
    taskId,
    status,
    expiresAt
  });
  writeFileSync(path.join(root, expiredLane), JSON.stringify(laneDocument('lane-expired-task', 'TASK-LANE-DONE', 'active', '2000-01-01T00:00:00.000Z')));
  writeFileSync(path.join(root, activeLane), JSON.stringify(laneDocument('lane-active-task', 'TASK-LANE-ACTIVE', 'active', '2999-01-01T00:00:00.000Z')));
  writeFileSync(path.join(root, freshDoneLane), JSON.stringify(laneDocument('lane-fresh-done-task', 'TASK-LANE-DONE', 'active', '2999-01-01T00:00:00.000Z')));
  writeFileSync(path.join(root, malformedLane), JSON.stringify({ ...laneDocument('lane-malformed', 'TASK-LANE-DONE', 'active', '2000-01-01T00:00:00.000Z'), status: 'unknown' }));

  const gitHead = '.atm/history/evidence/git-head.jsonl';
  const gitHeadAbsolute = path.join(root, gitHead);
  mkdirSync(path.dirname(gitHeadAbsolute), { recursive: true });
  writeFileSync(gitHeadAbsolute, '{"baseline":true}\n');
  execFileSync('git', ['add', '--', gitHead], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '--quiet', '-m', 'seed git-head evidence'], { cwd: root });
  writeFileSync(gitHeadAbsolute, '{"baseline":true}\n{"orphan":true}\n');

  const diagnose = runCleanup(['diagnose', '--cwd', root]) as any;
  assert.equal(diagnose.ok, true);
  assert.equal(diagnose.evidence.report.entries.some((entry: any) => entry.path === foreign && entry.recommendedAction === 'keep-active-owner'), true);
  const expiredLaneFinding = diagnose.evidence.report.entries.find((entry: any) => entry.path === expiredLane);
  assert.equal(expiredLaneFinding.ownerTaskId, 'TASK-LANE-DONE', 'lane residue owner task must come from its validated document');
  assert.equal(expiredLaneFinding.ownerActorId, 'agent-lane-owner', 'lane residue owner actor must come from its validated document');
  assert.equal(expiredLaneFinding.recommendedAction, 'safe-auto-clean', 'expired lane sessions for terminal tasks are disposable runtime residue');
  const activeLaneFinding = diagnose.evidence.report.entries.find((entry: any) => entry.path === activeLane);
  assert.equal(activeLaneFinding.ownerTaskId, 'TASK-LANE-ACTIVE', 'active lane residue must retain its task attribution');
  assert.equal(activeLaneFinding.ownerActorId, 'agent-lane-owner', 'active lane residue must retain its actor attribution');
  assert.equal(activeLaneFinding.recommendedAction, 'keep-active-owner', 'live lane sessions must never be auto-cleaned');
  const freshDoneLaneFinding = diagnose.evidence.report.entries.find((entry: any) => entry.path === freshDoneLane);
  assert.equal(freshDoneLaneFinding.recommendedAction, 'keep-active-owner', 'a live lane remains active even when its prior task is terminal');
  const malformedLaneFinding = diagnose.evidence.report.entries.find((entry: any) => entry.path === malformedLane);
  assert.equal(malformedLaneFinding.recommendedAction, 'manual-review', 'malformed lane lifecycle data must fail closed');

  const applied = runCleanup(['apply', '--cwd', root]) as any;
  assert.equal(applied.ok, true);
  assert.equal(existsSync(foreignAbsolute), true, 'cleanup apply must never remove foreign active-owner bytes');
  assert.equal(existsSync(path.join(root, expiredLane)), false, 'cleanup apply must remove expired lane residue for terminal tasks');
  assert.equal(existsSync(path.join(root, activeLane)), true, 'cleanup apply must preserve active lane sessions');
  assert.equal(existsSync(path.join(root, freshDoneLane)), true, 'cleanup apply must preserve a live lane linked to a terminal prior task');
  assert.equal(existsSync(path.join(root, malformedLane)), true, 'cleanup apply must preserve malformed lane documents');
  assert.doesNotThrow(() => execFileSync('git', ['diff', '--quiet', '--', gitHead], { cwd: root, stdio: 'ignore' }),
    'cleanup apply must restore receipt-classified hook evidence to Git-clean state');
  assert.equal(applied.evidence.report.actions.some((entry: any) => entry.path === gitHead && entry.action === 'restore' && entry.applied === true), true,
    'cleanup apply must report the successful safe restore instead of silently deferring it');
  console.log('[transient-artifact-lifecycle] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}

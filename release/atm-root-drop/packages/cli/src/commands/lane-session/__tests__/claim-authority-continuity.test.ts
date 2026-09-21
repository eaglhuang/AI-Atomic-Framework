import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diagnoseClaimRepairState } from '../../tasks/claim-repair-diagnostics.ts';
import { runTasksRepairClaim } from '../../tasks/repair-claim-orchestrator.ts';
import { inspectReferencedLaneSession } from '../resolve.ts';
import { mintLaneSession } from '../store.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-claim-authority-continuity-'));
const taskId = 'ATM-GOV-0342-fixture';
const now = new Date().toISOString();

try {
  mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
  writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
    workItemId: taskId,
    status: 'running',
    claim: {
      state: 'active',
      actorId: 'fixture-actor',
      leaseId: 'fixture-lease',
      claimedAt: now,
      heartbeatAt: now,
      ttlSeconds: 3600,
      files: ['packages/cli/src/commands/lane-session/resolve.ts'],
      laneSession: {
        laneSessionId: 'lane-missing-from-canonical-store',
        status: 'active',
        source: 'fixture',
        exportHint: 'export ATM_LANE_SESSION_ID="lane-missing-from-canonical-store"',
      },
    },
  }, null, 2)}\n`, 'utf8');

  assert.equal(inspectReferencedLaneSession({ cwd, laneSessionId: 'lane-missing-from-canonical-store', now }).availability, 'missing');
  mintLaneSession({
    cwd,
    actorId: 'fixture-actor',
    laneId: 'lane-released-by-owner',
    status: 'released',
    ttlMs: 3600_000,
    timestamp: now,
  });
  assert.equal(inspectReferencedLaneSession({ cwd, laneSessionId: 'lane-released-by-owner', now }).availability, 'released');
  mintLaneSession({
    cwd,
    actorId: 'fixture-actor',
    laneId: 'lane-expired-by-ttl',
    ttlMs: 1,
    timestamp: new Date(Date.parse(now) - 60_000).toISOString(),
  });
  assert.equal(inspectReferencedLaneSession({ cwd, laneSessionId: 'lane-expired-by-ttl', now }).availability, 'expired');
  const diagnosis = diagnoseClaimRepairState(cwd, taskId, 'fixture-actor');
  assert.equal(diagnosis.blocked, false);
  assert.equal(diagnosis.repairable, true);
  assert.ok(diagnosis.issues.some((issue) => issue.kind === 'unresolved-claim-lane'));
  assert.ok(!diagnosis.issues.some((issue) => issue.kind === 'valid-active-claim'));
  assert.match(diagnosis.writeCommand ?? '', /tasks repair-claim/);
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  const repair = await runTasksRepairClaim([
    '--cwd', cwd,
    '--task', taskId,
    '--actor', 'fixture-actor',
    '--write',
    '--reason', 'fixture recovery requires release and governed reclaim',
  ]);
  assert.equal(repair.ok, true);
  assert.ok((repair.evidence as { repairActions: readonly string[] }).repairActions.includes('released-unresolved-lane-claim'));
  const repairedTask = JSON.parse(readFileSync(taskPath, 'utf8')) as { status: string; claim: { state: string } };
  assert.equal(repairedTask.status, 'ready');
  assert.equal(repairedTask.claim.state, 'released');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('claim-authority-continuity: ok');

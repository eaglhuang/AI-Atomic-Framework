import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mintLaneSession } from '../../packages/cli/src/commands/lane-session/store.ts';
import { assertCurrentClaimOwnerForAction } from '../../packages/cli/src/commands/tasks/claim-ownership.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-renew-expired-lane-'));
try {
  const actorId = 'renew-owner';
  const taskId = 'TASK-RENEW-EXPIRED-LANE';
  const oldLane = mintLaneSession({
    cwd: repo,
    actorId,
    taskId,
    ttlMs: 1_000,
    timestamp: '2026-01-01T00:00:00.000Z'
  }).session;
  const currentClaim = {
    actorId,
    leaseId: 'lease-renew-expired-lane',
    claimedAt: '2026-01-01T00:00:00.000Z',
    heartbeatAt: '2026-01-01T00:00:00.000Z',
    ttlSeconds: 3_600,
    files: ['src/example.ts'],
    state: 'active' as const,
    laneSession: {
      laneSessionId: oldLane.laneId,
      status: oldLane.status,
      source: 'minted',
      exportHint: `export ATM_LANE_SESSION_ID=${JSON.stringify(oldLane.laneId)}`
    }
  };

  const renewedLane = assertCurrentClaimOwnerForAction({
    cwd: repo,
    taskId,
    actorId,
    action: 'renew',
    currentClaim
  });
  assert.equal(renewedLane.source, 'minted');
  assert.notEqual(renewedLane.session.laneId, oldLane.laneId);
  assert.equal(renewedLane.session.actorId, actorId);

  assert.throws(
    () => assertCurrentClaimOwnerForAction({ cwd: repo, taskId, actorId, action: 'release', currentClaim }),
    (error: unknown) => (error as { code?: string }).code === 'ATM_LANE_SESSION_OWNERSHIP_MISMATCH'
  );
  console.log('[claim-renew-expired-lane:test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTasksClaimLifecycle } from '../../packages/cli/src/commands/tasks/claim-orchestrator.ts';
import { readFrameworkTempLockProjection } from '../../packages/cli/src/commands/framework-development/framework-temp-lock-projection.ts';

delete process.env.ATM_LANE_SESSION_ID;
const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-temp-renew-'));
const taskId = 'ATM-FRAMEWORK-TEMP-worker';
const lockPath = path.join(cwd, '.atm/runtime/locks', `${taskId}.lock.json`);
mkdirSync(path.dirname(lockPath), { recursive: true });
const original = { workItemId: taskId, actorId: 'worker', lockedBy: 'worker', leaseId: 'lease-one',
  heartbeatAt: new Date(Date.now() - 1700_000).toISOString(), ttlSeconds: 1800,
  files: ['source.ts'], linkedTaskId: 'TASK-ONE', laneSessionId: null };
writeFileSync(lockPath, JSON.stringify(original));
const renew = (actor = 'worker') => runTasksClaimLifecycle('renew', ['--cwd', cwd, '--task', taskId, '--actor', actor, '--ttl-seconds', '7200']);
await assert.rejects(renew('other'), /exact live temporary framework claim/);
process.env.ATM_LANE_SESSION_ID = 'other-lane';
await assert.rejects(renew(), /exact live temporary framework claim/);
delete process.env.ATM_LANE_SESSION_ID;
const result = await renew();
assert.equal(result.ok, true);
const refreshed = JSON.parse(readFileSync(lockPath, 'utf8'));
assert.deepEqual({ ...refreshed, heartbeatAt: original.heartbeatAt, ttlSeconds: original.ttlSeconds }, original);
assert.equal(readFrameworkTempLockProjection(cwd, Date.now() + 3600_000)[0].leaseFresh, true);
assert.equal((result.evidence.receipt as { previousHeartbeatAt: string }).previousHeartbeatAt, original.heartbeatAt);
for (const extra of [{ heartbeatAt: '2000-01-01T00:00:00.000Z' }, { status: 'released' }]) {
  const bytes = JSON.stringify({ ...original, ...extra });
  writeFileSync(lockPath, bytes);
  await assert.rejects(renew(), /exact live temporary framework claim/);
  assert.equal(readFileSync(lockPath, 'utf8'), bytes);
}
console.log('[renew-framework-temp] ok');

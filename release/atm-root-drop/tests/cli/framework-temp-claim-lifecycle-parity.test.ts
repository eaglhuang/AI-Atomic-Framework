import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFrameworkTempLockProjection } from '../../packages/cli/src/commands/framework-development/framework-temp-lock-projection.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-temp-lock-projection-'));
try {
  const lockPath = path.join(repo, '.atm/runtime/locks/ATM-FRAMEWORK-TEMP-git.lock.json');
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify({
    workItemId: 'ATM-FRAMEWORK-TEMP-git', actorId: 'worker', heartbeatAt: '2026-07-28T00:00:00.000Z',
    ttlSeconds: 60, files: ['packages/cli/dist']
  }), 'utf8');
  const [projection] = readFrameworkTempLockProjection(repo, Date.parse('2026-07-28T00:00:30.000Z'));
  assert.equal(projection.workItemId, 'ATM-FRAMEWORK-TEMP-git');
  assert.equal(projection.leaseFresh, true);
  assert.deepEqual(projection.files, ['packages/cli/dist']);
  const [expired] = readFrameworkTempLockProjection(repo, Date.parse('2026-07-28T00:02:00.000Z'));
  assert.equal(expired.leaseFresh, false);
  console.log('[framework-temp-claim-lifecycle-parity.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

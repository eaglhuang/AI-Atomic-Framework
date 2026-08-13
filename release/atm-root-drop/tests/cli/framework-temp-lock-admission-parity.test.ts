import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFrameworkTempLockProjection, frameworkTempLockOwnsPath } from '../../packages/cli/src/commands/framework-development/framework-temp-lock-projection.ts';
import { buildActiveWorkSummary } from '../../packages/cli/src/commands/next/playbook-projection/active-work-summary.ts';
import { collectFrameworkTempClaimAllowedFiles } from '../../packages/cli/src/commands/hook/pre-commit/scope-ownership.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-g9-1-lock-parity-'));
try {
  const now = Date.now();
  const lockPath = path.join(repo, '.atm/runtime/locks/ATM-FRAMEWORK-TEMP-fixture.lock.json');
  mkdirSync(path.dirname(lockPath), { recursive: true });
  writeFileSync(lockPath, JSON.stringify({
    workItemId: 'ATM-FRAMEWORK-TEMP-fixture', actorId: 'fixture-actor', linkedTaskId: 'TASK-GIT-0017',
    laneSessionId: 'lane-fixture', heartbeatAt: new Date(now).toISOString(), ttlSeconds: 60,
    files: ['packages/cli/dist/**']
  }), 'utf8');
  const [fresh] = readFrameworkTempLockProjection(repo, now + 30_000);
  assert.equal(fresh.disposition, 'foreign-live');
  assert.equal(fresh.linkedTaskId, 'TASK-GIT-0017');
  assert.equal(frameworkTempLockOwnsPath([fresh], 'packages/cli/dist/commands/next.js')?.workItemId, fresh.workItemId);
  assert.deepEqual(collectFrameworkTempClaimAllowedFiles(repo), ['packages/cli/dist/**'], 'a fresh framework-temp claim must be consumable by pre-commit admission');
  const [expired] = readFrameworkTempLockProjection(repo, now + 120_000);
  assert.equal(expired.disposition, 'stale-recovery-input');
  writeFileSync(lockPath, JSON.stringify({
    workItemId: 'ATM-FRAMEWORK-TEMP-fixture', actorId: 'fixture-actor', linkedTaskId: 'TASK-GIT-0017',
    heartbeatAt: new Date(now - 120_000).toISOString(), ttlSeconds: 60, files: ['packages/cli/dist/**']
  }), 'utf8');
  assert.deepEqual(collectFrameworkTempClaimAllowedFiles(repo), [], 'an expired framework-temp claim must not authorize pre-commit admission');
  const summary = buildActiveWorkSummary(repo, 'captain');
  assert.equal(summary.activeLocks.length, 0, 'expired framework temp locks must not appear as active work');
  assert.equal(summary.staleRecoveryLocks.length, 1, 'expired framework temp locks remain attributable recovery inputs');
  console.log('[framework-temp-lock-admission-parity.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

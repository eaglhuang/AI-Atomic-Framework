import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRunnerBuildOutputInventory,
  inventoryPathsForPublication,
  inventoryRecoveryBlockers
} from '../../packages/core/src/broker/runner-build-output-inventory.ts';
import {
  frameworkTempLockOwnsPath,
  readFrameworkTempLockProjection
} from '../../packages/cli/src/commands/framework-development/framework-temp-lock-projection.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-g9-residue-'));
const taskId = 'TASK-GIT-0017';
const actorId = 'codex-git-series-captain';

function writeJson(relativePath: string, value: unknown) {
  const filePath = path.join(repo, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

try {
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  writeJson('.atm/runtime/locks/ATM-FRAMEWORK-TEMP-g9.lock.json', {
    workItemId: 'ATM-FRAMEWORK-TEMP-g9',
    actorId,
    heartbeatAt: now,
    ttlSeconds: 1800,
    files: ['packages/cli/dist/**', 'release/atm-onefile/**']
  });
  writeJson('.atm/runtime/locks/ATM-FRAMEWORK-TEMP-stale.lock.json', {
    workItemId: 'ATM-FRAMEWORK-TEMP-stale',
    actorId: 'older-worker',
    heartbeatAt: '2020-01-01T00:00:00.000Z',
    ttlSeconds: 1,
    files: ['release/atm-root-drop/**']
  });

  const locks = readFrameworkTempLockProjection(repo, nowMs);
  assert.equal(frameworkTempLockOwnsPath(locks, 'packages/cli/dist/atm.js')?.workItemId, 'ATM-FRAMEWORK-TEMP-g9');
  assert.equal(frameworkTempLockOwnsPath(locks, 'release/atm-root-drop/atm.mjs')?.leaseFresh, false);

  const inventory = buildRunnerBuildOutputInventory({
    sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
    currentTaskId: taskId,
    outputPaths: [
      'packages/cli/dist/atm.js',
      'release/atm-onefile/atm.mjs',
      'release/atm-root-drop/atm.mjs',
      'release/atm-onefile/release-manifest.json'
    ],
    ownership: [
      { path: 'packages/cli/dist/atm.js', ownerTaskId: taskId, ownerActorId: actorId, leaseFresh: true },
      { path: 'release/atm-onefile/atm.mjs', ownerTaskId: 'ATM-FRAMEWORK-TEMP-g9', ownerActorId: actorId, leaseFresh: true },
      { path: 'release/atm-root-drop/atm.mjs', ownerTaskId: 'ATM-FRAMEWORK-TEMP-stale', ownerActorId: 'older-worker', leaseFresh: false }
    ]
  });

  assert.deepEqual(inventory.entries.map((entry) => entry.disposition), [
    'owned-current', 'foreign-live', 'unowned', 'stale-recovery-input'
  ]);
  assert.deepEqual(inventoryPathsForPublication(inventory), ['packages/cli/dist/atm.js']);
  assert.deepEqual(inventoryRecoveryBlockers(inventory).map((entry) => entry.path), [
    'release/atm-onefile/atm.mjs',
    'release/atm-onefile/release-manifest.json'
  ]);
  console.log('[runner-publication-residue-classification.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

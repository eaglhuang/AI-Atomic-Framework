import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBroker } from '../../packages/cli/src/commands/broker/implementation.ts';
import { inspectRunnerSyncAdmission } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-framework-temp-'));
const taskId = 'ATM-FRAMEWORK-TEMP-codex-hotfix';
const actorId = 'codex-hotfix';
const sealedSourceSha = '0123456789abcdef0123456789abcdef01234567';

function writeJson(relativePath: string, value: unknown) {
  const filePath = path.join(repo, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

try {
  const now = new Date().toISOString();
  writeJson(`.atm/runtime/locks/${taskId}.lock.json`, {
    schemaId: 'atm.governanceScopeLock',
    specVersion: '0.1.0',
    workItemId: taskId,
    lockedBy: actorId,
    lockedAt: now,
    actorId,
    leaseId: 'lease-framework-temp-hotfix',
    leaseEpoch: Date.now(),
    heartbeatAt: now,
    ttlSeconds: 1800,
    files: [
      'packages/cli/src/commands/broker/steward-queues.ts',
      'packages/cli/src/commands/framework-development/runner-sync-admission.ts'
    ]
  });

  const enqueue = await runBroker([
    'runner-sync',
    'enqueue',
    '--cwd', repo,
    '--task', taskId,
    '--actor', actorId,
    '--sealed-source-sha', sealedSourceSha,
    '--surface', 'release/atm-onefile/atm.mjs',
    '--surface', 'release/atm-root-drop'
  ]) as any;
  assert.equal(enqueue.ok, true, 'framework temp claim should be able to enqueue runner-sync');
  assert.equal(enqueue.evidence.runnerSync.queueHeadHealth, 'task-active');
  assert.equal(enqueue.evidence.runnerSync.status, 'queue-head');

  const queuePath = path.join(repo, '.atm/runtime/runner-sync-steward-queue.json');
  assert.equal(existsSync(queuePath), true, 'enqueue must write runner-sync steward queue');
  const queue = JSON.parse(readFileSync(queuePath, 'utf8')) as any;
  assert.equal(queue.groups[0]?.requests[0]?.taskId, taskId);

  const admission = inspectRunnerSyncAdmission({
    cwd: repo,
    stewardActorId: actorId,
    sealedSourceSha,
    dirtyFiles: ['release/atm-onefile/atm.mjs'],
    foreignClaims: []
  });
  assert.equal(admission.ok, true, 'framework temp queue-head should satisfy runner-sync admission');
  assert.equal(admission.queueHeadOwnership.queueHeadHealth, 'task-active');
  assert.equal(admission.queueHeadOwnership.stewardWorkId, enqueue.evidence.runnerSync.stewardWorkId);
  assert.deepEqual(admission.queueHeadOwnership.ownerActorIds, [actorId]);

  const missingTempAdmission = inspectRunnerSyncAdmission({
    cwd: repo,
    stewardActorId: actorId,
    sealedSourceSha: 'fedcba9876543210fedcba9876543210fedcba98',
    runnerSyncSteward: {
      stewardWorkId: 'runner-sync-missing-temp',
      queuePosition: 1,
      suggestedNextAction: 'run runner sync',
      requests: [{ taskId: 'ATM-FRAMEWORK-TEMP-missing', actorId, requestedSurfaces: ['release/atm-onefile/atm.mjs'] }]
    },
    dirtyFiles: [],
    foreignClaims: []
  });
  assert.equal(missingTempAdmission.ok, false, 'missing framework temp lock must not be treated as active');
  assert.equal(missingTempAdmission.queueHeadOwnership.queueHeadHealth, 'task-missing');

  console.log('[runner-sync-framework-temp-hotfix.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

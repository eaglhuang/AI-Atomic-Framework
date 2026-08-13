import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBroker } from '../../packages/cli/src/commands/broker/implementation.ts';
import { inspectRunnerSyncAdmission } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-framework-temp-'));
const taskId = 'ATM-FRAMEWORK-TEMP-codex-hotfix';
const actorId = 'codex-hotfix';

function writeJson(relativePath: string, value: unknown) {
  const filePath = path.join(repo, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

try {
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'fixture'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'fixture@example.com'], { cwd: repo });
  writeFileSync(path.join(repo, 'seed.txt'), 'seed\n');
  writeJson('release/atm-onefile/release-manifest.json', { baseline: true });
  execFileSync('git', ['add', 'seed.txt', 'release/atm-onefile/release-manifest.json'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'seed'], { cwd: repo, stdio: 'ignore' });
  const sealedSourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
  mkdirSync(path.join(repo, '.atm', 'history', 'evidence'), { recursive: true });
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

  writeJson('release/atm-onefile/release-manifest.json', { stale: true });
  const takeover = await runBroker([
    'runner-sync',
    'takeover-publication',
    '--cwd', repo,
    '--task', taskId,
    '--actor', actorId,
    '--sealed-source-sha', sealedSourceSha,
    '--surface', 'full'
  ]) as any;
  assert.equal(takeover.ok, true, 'active framework-temp queue head should authorize a digest-bound publication takeover');
  assert.deepEqual(takeover.evidence.plan.entries.map((entry: any) => entry.path), ['release/atm-onefile/release-manifest.json']);
  assert.equal(existsSync(path.join(repo, takeover.evidence.receiptPath)), true);

  await assert.rejects(
    () => runBroker([
      'runner-sync',
      'takeover-publication',
      '--cwd', repo,
      '--task', taskId,
      '--actor', 'foreign-actor',
      '--sealed-source-sha', sealedSourceSha,
      '--surface', 'full'
    ]),
    /not foreign-actor/,
    'framework-temp takeover must remain actor-bound'
  );

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

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-release-'));
const root = process.cwd();
const atmCliEntrypoint = path.join(root, 'packages/cli/src/atm.ts');

function runAtm(args: readonly string[], expectStatus = 0): Record<string, any> {
  const result = spawnSync(process.execPath, ['--strip-types', atmCliEntrypoint, ...args, '--cwd', repo, '--json'], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  assert.equal(
    result.status,
    expectStatus,
    `unexpected status for ${args.join(' ')}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
  );
  const payload = result.stdout.trim() || result.stderr.trim();
  return JSON.parse(payload) as Record<string, any>;
}

try {
  const first = runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', 'TASK-A',
    '--actor', 'captain-a',
    '--sealed-source-sha', 'sha256:source-a',
    '--surface', 'release/atm-onefile/atm.mjs'
  ]);
  const stewardWorkId = first.evidence.runnerSync.stewardWorkId;

  const coalesced = runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', 'TASK-B',
    '--actor', 'captain-b',
    '--sealed-source-sha', 'sha256:source-a',
    '--surface', 'release/atm-root-drop/atm.mjs'
  ]);
  assert.equal(coalesced.evidence.runnerSync.stewardWorkId, stewardWorkId);
  assert.deepEqual(coalesced.evidence.runnerSync.waitingTasks, ['TASK-A', 'TASK-B']);

  const waiting = runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', 'TASK-C',
    '--actor', 'captain-c',
    '--sealed-source-sha', 'sha256:source-c',
    '--surface', 'release/atm-root-drop/release-manifest.json'
  ]);
  assert.equal(waiting.evidence.runnerSync.queuePosition, 2);

  const missingReceipt = runAtm([
    'broker',
    'runner-sync',
    'release',
    '--task', 'TASK-A',
    '--steward-work-id', stewardWorkId
  ], 1);
  assert.equal(missingReceipt.messages[0].code, 'ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_REQUIRED');

  const released = runAtm([
    'broker',
    'runner-sync',
    'release',
    '--task', 'TASK-A',
    '--steward-work-id', stewardWorkId,
    '--receipt-ref', '.atm/history/evidence/TASK-A.runner-sync-receipt.json'
  ]);
  assert.equal(released.messages[0].code, 'ATM_BROKER_RUNNER_SYNC_RELEASED');
  assert.deepEqual(released.evidence.release.released.waitingTasks, ['TASK-A', 'TASK-B']);
  assert.equal(released.evidence.release.next.stewardWorkId, waiting.evidence.runnerSync.stewardWorkId);

  const queuePath = path.join(repo, '.atm/runtime/runner-sync-steward-queue.json');
  const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
  assert.equal(queue.groups.length, 1);
  assert.deepEqual(queue.groups[0].waitingTasks, ['TASK-C']);

  const staleQueue = {
    ...queue,
    groups: queue.groups.map((group: any) => ({
      ...group,
      waitingTasks: ['TASK-STALE'],
      requests: group.requests.map((request: any) => ({
        ...request,
        taskId: 'TASK-STALE',
        actorId: 'stale-captain',
        heartbeatAt: '2026-07-15T00:00:00.000Z',
        expiresAt: '2026-07-15T00:00:01.000Z',
        ttlSeconds: 1
      }))
    }))
  };
  writeFileSync(queuePath, `${JSON.stringify(staleQueue, null, 2)}\n`, 'utf8');
  const cleanup = runAtm([
    'broker',
    'runner-sync',
    'cleanup'
  ]);
  assert.equal(cleanup.messages[0].code, 'ATM_BROKER_RUNNER_SYNC_CLEANUP');
  assert.equal(cleanup.evidence.cleanup.staleReleases.length, 1);
  assert.equal(cleanup.evidence.cleanup.staleReleases[0].taskId, 'TASK-STALE');
  assert.equal(cleanup.evidence.cleanup.staleReleases[0].reason, 'ttl-expired');
  const cleanedQueue = JSON.parse(readFileSync(queuePath, 'utf8'));
  assert.equal(cleanedQueue.groups.length, 0, 'stale runner-sync steward owner must be removed by CLI cleanup');

  runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', 'TASK-MISSING',
    '--actor', 'missing-captain',
    '--sealed-source-sha', 'sha256:missing',
    '--surface', 'release/atm-onefile/atm.mjs'
  ]);
  const missingCleanup = runAtm([
    'broker',
    'runner-sync',
    'cleanup'
  ]);
  assert.equal(missingCleanup.evidence.cleanup.staleReleases.length, 1);
  assert.equal(missingCleanup.evidence.cleanup.staleReleases[0].taskId, 'TASK-MISSING');
  assert.equal(missingCleanup.evidence.cleanup.staleReleases[0].reason, 'orphan-task-missing');

  const taskDir = path.join(repo, '.atm/history/tasks');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, 'TASK-DONE.json'), `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-DONE',
    status: 'done'
  }, null, 2)}\n`, 'utf8');
  runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', 'TASK-DONE',
    '--actor', 'done-captain',
    '--sealed-source-sha', 'sha256:done',
    '--surface', 'release/atm-onefile/atm.mjs'
  ]);
  const terminalCleanup = runAtm([
    'broker',
    'runner-sync',
    'cleanup'
  ]);
  assert.equal(terminalCleanup.evidence.cleanup.staleReleases.length, 1);
  assert.equal(terminalCleanup.evidence.cleanup.staleReleases[0].taskId, 'TASK-DONE');
  assert.equal(terminalCleanup.evidence.cleanup.staleReleases[0].reason, 'orphan-task-terminal');

  console.log('[runner-sync-steward-release.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

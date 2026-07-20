import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertRunnerSyncAdmission,
  inspectRunnerSyncAdmission
} from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-orphan-head-'));
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

function writeTask(taskId: string, status = 'planned'): void {
  const taskDir = path.join(repo, '.atm', 'history', 'tasks');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, `${taskId}.json`), `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    status
  }, null, 2)}\n`, 'utf8');
}

try {
  const orphanSha = 'a'.repeat(40);
  const waiterSha = 'b'.repeat(40);
  const missing = runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', 'TASK-MISSING',
    '--actor', 'missing-captain',
    '--sealed-source-sha', 'sha256:missing',
    '--surface', 'release/atm-onefile/atm.mjs'
  ], 1);
  assert.equal(missing.messages[0].code, 'ATM_RUNNER_SYNC_ENQUEUE_TASK_INVALID');

  writeTask('TASK-DONE', 'done');
  const terminal = runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', 'TASK-DONE',
    '--actor', 'done-captain',
    '--sealed-source-sha', 'sha256:done',
    '--surface', 'release/atm-onefile/atm.mjs'
  ], 1);
  assert.equal(terminal.messages[0].code, 'ATM_RUNNER_SYNC_ENQUEUE_TASK_INVALID');

  writeTask('TASK-ORPHAN');
  const orphanHead = runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', 'TASK-ORPHAN',
    '--actor', 'orphan-captain',
    '--sealed-source-sha', orphanSha,
    '--surface', 'release/atm-onefile/atm.mjs'
  ]);
  assert.equal(orphanHead.evidence.runnerSync.queuePosition, 1);
  assert.equal(orphanHead.evidence.runnerSync.queueHeadHealth, 'task-active');
  rmSync(path.join(repo, '.atm', 'history', 'tasks', 'TASK-ORPHAN.json'));

  writeTask('TASK-WAITER');
  const waiter = runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', 'TASK-WAITER',
    '--actor', 'waiter-captain',
    '--sealed-source-sha', waiterSha,
    '--surface', 'release/atm-root-drop/release-manifest.json'
  ]);
  assert.equal(waiter.evidence.runnerSync.queuePosition, 2);
  assert.equal(waiter.evidence.runnerSync.queueHeadHealth, 'task-active');

  const report = inspectRunnerSyncAdmission({
    cwd: repo,
    stewardActorId: 'orphan-captain',
    sealedSourceSha: orphanSha,
    dirtyFiles: []
  });
  assert.equal(report.ok, false);
  assert.equal(report.queueHeadOwnership.queueHeadHealth, 'task-missing');
  assert.equal(report.queueHeadOwnership.cleanupCommand, 'node atm.mjs broker runner-sync cleanup --json');
  assert.match(report.requiredCommand ?? '', /broker runner-sync cleanup/);
  assert.throws(() => assertRunnerSyncAdmission(report), (error: any) => {
    assert.equal(error.code, 'ATM_RUNNER_SYNC_QUEUE_HEAD_ORPHANED');
    assert.match(error.message, /orphaned/);
    return true;
  });

  const cleanup = runAtm([
    'broker',
    'runner-sync',
    'cleanup'
  ]);
  assert.equal(cleanup.evidence.cleanup.staleReleases.length, 1);
  assert.equal(cleanup.evidence.cleanup.staleReleases[0].taskId, 'TASK-ORPHAN');
  assert.equal(cleanup.evidence.cleanup.staleReleases[0].reason, 'orphan-task-missing');
  assert.match(cleanup.evidence.cleanup.staleReleases[0].safeRetryCommand, /broker runner-sync enqueue/);

  const queuePath = path.join(repo, '.atm/runtime/runner-sync-steward-queue.json');
  const queue = JSON.parse(readFileSync(queuePath, 'utf8'));
  assert.equal(queue.groups.length, 1);
  assert.deepEqual(queue.groups[0].waitingTasks, ['TASK-WAITER']);
  assert.equal(queue.groups[0].queuePosition, 1);
  assert.equal(queue.groups[0].queueHeadHealth, 'task-active');

  const status = runAtm([
    'broker',
    'runner-sync',
    'status',
    '--task', 'TASK-WAITER'
  ]);
  assert.equal(status.evidence.position.queuePosition, 1);
  assert.equal(status.evidence.position.queueHeadHealth, 'task-active');

  console.log('[runner-sync-orphan-head.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

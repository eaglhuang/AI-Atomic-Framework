import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-stale-lifecycle-'));
const root = process.cwd();
const atmCliEntrypoint = path.join(root, 'packages/cli/src/atm.ts');
const actorId = 'captain-stale-lifecycle';
const taskId = 'TASK-RUNNER-SYNC-STALE';
const firstSha = '1'.repeat(40);
const secondSha = '2'.repeat(40);

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
  return JSON.parse((result.stdout.trim() || result.stderr.trim()) || '{}') as Record<string, any>;
}

function writeTask(status = 'running'): void {
  const taskDir = path.join(repo, '.atm/history/tasks');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, `${taskId}.json`), `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    status
  }, null, 2)}\n`, 'utf8');
}

try {
  writeTask();
  const first = runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', taskId,
    '--actor', actorId,
    '--sealed-source-sha', firstSha,
    '--surface', 'release/atm-onefile/atm.mjs'
  ]);
  assert.equal(first.evidence.runnerSync.queuePosition, 1);
  assert.equal(first.evidence.runnerSync.sealedSourceSha, firstSha);

  const second = runAtm([
    'broker',
    'runner-sync',
    'enqueue',
    '--task', taskId,
    '--actor', actorId,
    '--sealed-source-sha', secondSha,
    '--surface', 'release/atm-root-drop/atm.mjs'
  ]);
  assert.equal(second.evidence.runnerSync.status, 'queue-head');
  assert.equal(second.evidence.runnerSync.queuePosition, 1);
  assert.equal(second.evidence.runnerSync.sealedSourceSha, secondSha);

  const queuePath = path.join(repo, '.atm/runtime/runner-sync-steward-queue.json');
  const queue = JSON.parse(readFileSync(queuePath, 'utf8')) as any;
  assert.equal(queue.groups.length, 1, 'new same-task source must replace the old unsatisfied reservation');
  assert.equal(queue.groups[0].sealedSourceSha, secondSha);
  assert.deepEqual(queue.groups[0].waitingTasks, [taskId]);

  const residueQueue = {
    ...queue,
    groups: [
      {
        ...queue.groups[0],
        stewardWorkId: first.evidence.runnerSync.stewardWorkId,
        sealedSourceSha: firstSha,
        requestedSurfaces: ['release/atm-onefile/atm.mjs'],
        waitingTasks: [taskId],
        requests: [{
          ...queue.groups[0].requests[0],
          sealedSourceSha: firstSha,
          requestedSurfaces: ['release/atm-onefile/atm.mjs'],
          createdAt: '2026-07-21T00:00:00.000Z',
          heartbeatAt: '2026-07-21T00:00:00.000Z',
          expiresAt: '2026-07-21T00:07:00.000Z'
        }]
      },
      queue.groups[0]
    ]
  };
  writeFileSync(queuePath, `${JSON.stringify(residueQueue, null, 2)}\n`, 'utf8');

  const cleanup = runAtm([
    'broker',
    'runner-sync',
    'cleanup'
  ]);
  assert.equal(cleanup.messages[0].code, 'ATM_BROKER_RUNNER_SYNC_CLEANUP');
  assert.equal(cleanup.evidence.cleanup.staleReleases.length, 1);
  assert.equal(cleanup.evidence.cleanup.staleReleases[0].reason, 'superseded-task-generation');
  const cleaned = JSON.parse(readFileSync(queuePath, 'utf8')) as any;
  assert.equal(cleaned.groups.length, 1);
  assert.equal(cleaned.groups[0].sealedSourceSha, secondSha);
  assert.equal(cleaned.groups[0].queuePosition, 1);

  console.log('[runner-sync-stale-reservation-lifecycle.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

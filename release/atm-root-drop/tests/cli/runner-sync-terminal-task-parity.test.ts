import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBroker } from '../../packages/cli/src/commands/broker/implementation.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-terminal-parity-'));

function writeTask(taskId: string, status: string): void {
  const taskDir = path.join(repo, '.atm/history/tasks');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, `${taskId}.json`), `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    status
  }, null, 2)}\n`, 'utf8');
}

try {
  writeTask('TASK-DONE-GHOST', 'running');
  writeTask('TASK-LIVE-WAITING', 'running');
  await runBroker([
    'runner-sync',
    'enqueue',
    '--cwd', repo,
    '--task', 'TASK-DONE-GHOST',
    '--actor', 'terminal-captain',
    '--sealed-source-sha', '1'.repeat(40),
    '--surface', 'release/atm-onefile/atm.mjs'
  ]);
  await runBroker([
    'runner-sync',
    'enqueue',
    '--cwd', repo,
    '--task', 'TASK-LIVE-WAITING',
    '--actor', 'waiting-captain',
    '--sealed-source-sha', '2'.repeat(40),
    '--surface', 'release/atm-root-drop/atm.mjs'
  ]);

  writeTask('TASK-DONE-GHOST', 'done');
  const cleanup = await runBroker([
    'runner-sync',
    'cleanup',
    '--cwd', repo
  ]) as any;

  assert.equal(cleanup.ok, true);
  assert.equal(cleanup.evidence.cleanup.staleReleases.length, 1);
  assert.equal(cleanup.evidence.cleanup.staleReleases[0].reason, 'orphan-task-terminal');
  const queue = JSON.parse(readFileSync(path.join(repo, '.atm/runtime/runner-sync-steward-queue.json'), 'utf8')) as any;
  assert.equal(queue.groups.length, 1);
  assert.equal(queue.groups[0].queuePosition, 1);
  assert.deepEqual(queue.groups[0].waitingTasks, ['TASK-LIVE-WAITING']);
  assert.equal(queue.groups.filter((group: any) => group.waitingTasks?.includes('TASK-DONE-GHOST')).length, 0);

  console.log('[runner-sync-terminal-task-parity.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

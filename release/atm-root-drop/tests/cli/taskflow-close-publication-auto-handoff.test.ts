import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueueTaskflowClosePublication } from '../../packages/cli/src/commands/taskflow/runner-publication-close-queue.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-close-publication-handoff-'));
const seal = 'a'.repeat(40);

function writeTask(taskId: string, actorId: string): void {
  const now = new Date().toISOString();
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  mkdirSync(path.dirname(taskPath), { recursive: true });
  writeFileSync(taskPath, `${JSON.stringify({
    workItemId: taskId,
    status: 'running',
    claim: {
      actorId,
      leaseId: `lease-${taskId}`,
      claimedAt: now,
      heartbeatAt: now,
      ttlSeconds: 3600,
      state: 'active'
    }
  }, null, 2)}\n`, 'utf8');
}

try {
  writeTask('TASK-CLOSE-A', 'captain-a');
  writeTask('TASK-CLOSE-B', 'captain-b');

  const first = enqueueTaskflowClosePublication({ cwd, taskId: 'TASK-CLOSE-A', actorId: 'captain-a', sealedSourceSha: seal });
  const second = enqueueTaskflowClosePublication({ cwd, taskId: 'TASK-CLOSE-B', actorId: 'captain-b', sealedSourceSha: seal });

  assert.equal(first.queuePosition, 1);
  assert.equal(second.queuePosition, 1, 'same-source close requests share one short publication critical section');
  assert.equal(second.stewardWorkId, first.stewardWorkId);
  assert.deepEqual(second.waitingTasks, ['TASK-CLOSE-A', 'TASK-CLOSE-B']);
  assert.deepEqual(second.queue.groups[0]?.requests.map((entry) => entry.actorId).sort(), ['captain-a', 'captain-b']);

  const persisted = JSON.parse(readFileSync(path.join(cwd, '.atm', 'runtime', 'runner-sync-steward-queue.json'), 'utf8'));
  assert.equal(persisted.groups.length, 1);
  assert.deepEqual(persisted.groups[0].waitingTasks, ['TASK-CLOSE-A', 'TASK-CLOSE-B']);
  console.log('[taskflow-close-publication-auto-handoff] ok');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}


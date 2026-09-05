import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDeterministicTaskIntent, inspectImportedTaskQueue } from '../../packages/cli/src/commands/next/route-resolution.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-next-running-explicit-route-'));

try {
  const taskId = 'TASK-RUNNING-EXPLICIT';
  const taskDir = path.join(cwd, '.atm', 'history', 'tasks');
  mkdirSync(taskDir, { recursive: true });
  writeFileSync(path.join(taskDir, `${taskId}.json`), `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Already claimed task',
    status: 'running',
    scopePaths: ['packages/integrations-core/src/compiler/running.ts'],
    source: { planPath: `planning/tasks/${taskId}.task.md` },
    claim: {
      state: 'active',
      actorId: 'codex-captain',
      intent: 'write',
      laneSession: { laneSessionId: 'lane-current' }
    }
  }, null, 2)}\n`, 'utf8');

  const intent = createDeterministicTaskIntent(taskId, [taskId]);
  const queue = inspectImportedTaskQueue(cwd, intent);
  assert.equal(queue.promptScope?.status, 'ready');
  assert.equal(queue.promptScope?.selectedTasks[0]?.workItemId, taskId);
  assert.equal(queue.selectedTask?.workItemId, taskId);
  console.log('ok - explicit running task route');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDeterministicTaskIntent, inspectImportedTaskQueue } from '../../packages/cli/src/commands/next/route-resolution.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-next-route-resolution-latency-'));
const taskDir = path.join(cwd, '.atm', 'history', 'tasks');

function writeTask(workItemId: string, scopePath: string) {
  writeFileSync(path.join(taskDir, `${workItemId}.json`), `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId,
    title: workItemId,
    status: 'open',
    scopePaths: [scopePath],
    source: { planPath: `planning/tasks/${workItemId}.task.md` }
  }, null, 2)}\n`, 'utf8');
}

try {
  mkdirSync(taskDir, { recursive: true });
  const selectedId = 'TASK-ROUTE-0105';
  writeTask(selectedId, 'packages/selected.ts');
  writeTask('TASK-ROUTE-0106', 'packages/unrelated.ts');

  const intent = createDeterministicTaskIntent(`Implement ${selectedId}`);
  const queue = inspectImportedTaskQueue(cwd, intent);
  assert.equal(queue.selectedTask?.workItemId, selectedId);
  const unrelated = queue.tasks.find((task) => task.workItemId === 'TASK-ROUTE-0106');
  assert.deepEqual(unrelated?.scopePaths, [], 'explicit task-id route must not hydrate unrelated task scopes');
  assert.deepEqual(queue.selectedTask?.scopePaths, ['packages/selected.ts']);
  console.log('ok - explicit route avoids unrelated scope hydration');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

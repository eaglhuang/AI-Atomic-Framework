import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBatch } from '../batch.ts';
import { writeBatchRun } from '../work-channels.ts';
import { createOrRefreshTaskQueue, type TaskDirectionTask } from '../task-direction.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makeTask(taskId: string): TaskDirectionTask {
  return {
    workItemId: taskId,
    title: taskId,
    dependencies: [],
    taskPath: `.atm/history/tasks/${taskId}.json`,
    sourcePlanPath: null,
    nearbyPlanPaths: [],
    scopePaths: ['packages/cli/src/commands/batch.ts'],
    targetRepo: null,
    allowPlanningMirror: false
  };
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'batch-skip-resume-'));
try {
  const tasks = [makeTask('TASK-SKIP-A'), makeTask('TASK-SKIP-B')];
  for (const task of tasks) {
    writeJson(path.join(repo, task.taskPath), {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: task.workItemId,
      title: task.title,
      status: 'running',
      scopePaths: task.scopePaths,
      deliverables: task.scopePaths,
      validators: ['npm run typecheck']
    });
  }
  const queue = createOrRefreshTaskQueue({
    cwd: repo,
    sourcePrompt: 'batch skip resume fixture',
    tasks,
    actorId: 'validator',
    taskIds: tasks.map((task) => task.workItemId)
  });
  const batchRun = writeBatchRun({
    cwd: repo,
    sourcePrompt: 'batch skip resume fixture',
    tasks,
    queue,
    actorId: 'validator'
  });
  createOrRefreshTaskQueue({
    cwd: repo,
    sourcePrompt: 'batch skip resume fixture',
    tasks,
    actorId: 'validator',
    taskIds: tasks.map((task) => task.workItemId),
    batchId: batchRun.batchId,
    scopeKey: batchRun.scopeKey
  });

  const skipResult = await runBatch([
    'skip',
    '--cwd',
    repo,
    '--actor',
    'validator',
    '--batch',
    batchRun.batchId,
    '--task',
    'TASK-SKIP-A',
    '--reason',
    'external dependency blocked',
    '--json'
  ]);
  assert.equal(skipResult.ok, true, 'batch skip must succeed');
  assert.equal((skipResult.evidence as any)?.batchRun?.currentTaskId, 'TASK-SKIP-B');
  assert.equal((skipResult.evidence as any)?.skippedTask?.taskId, 'TASK-SKIP-A');
  assert.match(String(skipResult.messages?.[0]?.code ?? ''), /ATM_BATCH_TASK_SKIPPED/);

  const resumeResult = await runBatch([
    'resume',
    '--cwd',
    repo,
    '--actor',
    'validator',
    '--batch',
    batchRun.batchId,
    '--task',
    'TASK-SKIP-A',
    '--json'
  ]);
  assert.equal(resumeResult.ok, true, 'batch resume must restore skipped task');
  assert.equal((resumeResult.evidence as any)?.after?.currentTaskId, 'TASK-SKIP-A');
  assert.deepEqual((resumeResult.evidence as any)?.after?.skippedTasks ?? [], []);

  const skipEventDir = path.join(repo, '.atm', 'history', 'task-events', 'TASK-SKIP-A');
  const skipEvent = readFileSync(path.join(skipEventDir, readdirName(skipEventDir, 'batch-skip')), 'utf8');
  assert.match(skipEvent, /"action": "batch-skip"/);

  console.log('[batch-skip-resume.spec] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

function readdirName(dir: string, action: string) {
  return readdirSync(dir).find((entry) => entry.includes(action)) as string;
}

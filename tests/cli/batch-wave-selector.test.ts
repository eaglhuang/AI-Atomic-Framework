import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBatch } from '../../packages/cli/src/commands/batch.ts';
import { createOrRefreshTaskQueue, type TaskDirectionTask } from '../../packages/cli/src/commands/task-direction.ts';
import { writeBatchRun } from '../../packages/cli/src/commands/work-channels.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function task(taskId: string, scopePaths = ['packages/cli/src/commands/batch/selector.ts']): TaskDirectionTask {
  return {
    workItemId: taskId,
    title: taskId,
    dependencies: [],
    taskPath: `.atm/history/tasks/${taskId}.json`,
    sourcePlanPath: `planning/${taskId}.task.md`,
    nearbyPlanPaths: [],
    scopePaths,
    targetRepo: 'AI-Atomic-Framework',
    allowPlanningMirror: false
  };
}

function writeTaskRecord(repo: string, entry: TaskDirectionTask, overrides: Record<string, unknown> = {}) {
  writeJson(path.join(repo, entry.taskPath), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: entry.workItemId,
    title: entry.title,
    status: 'ready',
    targetRepo: 'AI-Atomic-Framework',
    scopePaths: entry.scopePaths,
    deliverables: entry.scopePaths,
    validators: ['npm run typecheck'],
    ...overrides
  });
}

async function buildFixture(tasks: readonly TaskDirectionTask[]) {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'batch-wave-selector-'));
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'batch-wave-selector'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'batch-wave-selector@example.test'], { cwd: repo, stdio: 'ignore' });
  writeFileSync(path.join(repo, 'README.md'), 'batch wave selector fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
  const queue = createOrRefreshTaskQueue({
    cwd: repo,
    sourcePrompt: 'batch wave selector fixture',
    tasks,
    actorId: 'validator',
    taskIds: tasks.map((entry) => entry.workItemId)
  });
  const batchRun = writeBatchRun({
    cwd: repo,
    sourcePrompt: 'batch wave selector fixture',
    tasks,
    queue,
    actorId: 'validator'
  });
  createOrRefreshTaskQueue({
    cwd: repo,
    sourcePrompt: 'batch wave selector fixture',
    tasks,
    actorId: 'validator',
    taskIds: tasks.map((entry) => entry.workItemId),
    batchId: batchRun.batchId,
    scopeKey: batchRun.scopeKey
  });
  return { repo, batchRun };
}

async function testWaveSelectionAndDeferredReasons() {
  const tasks = [
    task('TASK-WAVE-A'),
    task('TASK-WAVE-B'),
    task('TASK-WAVE-C'),
    task('TASK-WAVE-D', ['packages/core/src/broker/wave-manifest.ts']),
    task('TASK-WAVE-E')
  ];
  const { repo, batchRun } = await buildFixture(tasks);
  try {
    for (const entry of tasks) writeTaskRecord(repo, entry);
    writeTaskRecord(repo, tasks[2], { dependencies: ['TASK-WAVE-MISSING'] });
    writeTaskRecord(repo, tasks[3]);
    writeTaskRecord(repo, tasks[4], { validators: [] });
    const result = await runBatch(['current', '--cwd', repo, '--batch', batchRun.batchId, '--compact', '--json']);
    assert.equal(result.ok, true);
    const wave = (result.evidence as any).current.currentWave;
    assert.equal(wave.status, 'wave-ready');
    assert.deepEqual(wave.selectedTaskIds, ['TASK-WAVE-A', 'TASK-WAVE-B']);
    assert.equal(wave.currentWave.schemaId, 'atm.waveManifest.v1');
    assert.match(wave.dispatchCommand, /team wave dispatch/);
    assert.deepEqual(wave.deferredReasons.map((entry: any) => entry.reasonCode), [
      'dependency-not-ready',
      'wave-incompatible',
      'validators-missing'
    ]);
    const rerun = await runBatch(['current', '--cwd', repo, '--batch', batchRun.batchId, '--compact', '--json']);
    assert.equal((rerun.evidence as any).current.currentWave.currentWave.waveId, wave.currentWave.waveId);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

async function testMaxWaveSizeAndSerialFallback() {
  const manyTasks = ['A', 'B', 'C', 'D', 'E'].map((suffix) => task(`TASK-MAX-${suffix}`));
  const many = await buildFixture(manyTasks);
  try {
    for (const entry of manyTasks) writeTaskRecord(many.repo, entry);
    const result = await runBatch(['current', '--cwd', many.repo, '--batch', many.batchRun.batchId, '--compact', '--json']);
    const wave = (result.evidence as any).current.currentWave;
    assert.deepEqual(wave.selectedTaskIds, ['TASK-MAX-A', 'TASK-MAX-B', 'TASK-MAX-C', 'TASK-MAX-D']);
    assert.deepEqual(wave.deferredReasons.map((entry: any) => entry.reasonCode), ['max-wave-size']);
  } finally {
    rmSync(many.repo, { recursive: true, force: true });
  }

  const singleTask = [task('TASK-SERIAL-A')];
  const single = await buildFixture(singleTask);
  try {
    writeTaskRecord(single.repo, singleTask[0]);
    const result = await runBatch(['current', '--cwd', single.repo, '--batch', single.batchRun.batchId, '--compact', '--json']);
    const wave = (result.evidence as any).current.currentWave;
    assert.equal(wave.status, 'serial-fallback');
    assert.equal(wave.serialFallback, true);
    assert.equal(wave.dispatchCommand, null);
  } finally {
    rmSync(single.repo, { recursive: true, force: true });
  }
}

await testWaveSelectionAndDeferredReasons();
await testMaxWaveSizeAndSerialFallback();

console.log('[batch-wave-selector.test] ok');

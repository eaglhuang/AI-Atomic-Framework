import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTeamWorkerExecutionRuntime } from '../../packages/core/src/team-agents/worker-executor.ts';
import { createWaveManifest } from '../../packages/core/src/broker/wave-manifest.ts';
import { runTeam } from '../../packages/cli/src/commands/team.ts';
import { createOrRefreshTaskQueue, type TaskDirectionTask } from '../../packages/cli/src/commands/task-direction.ts';
import { writeBatchRun } from '../../packages/cli/src/commands/work-channels.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function initRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'real-team-wave-worker-'));
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'real-team-wave-worker'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'real-team-wave-worker@example.test'], { cwd: repo, stdio: 'ignore' });
  writeFileSync(path.join(repo, 'README.md'), 'real team wave worker fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

function task(taskId: string): TaskDirectionTask {
  return {
    workItemId: taskId,
    title: taskId,
    dependencies: [],
    taskPath: `.atm/history/tasks/${taskId}.json`,
    sourcePlanPath: `planning/${taskId}.task.md`,
    nearbyPlanPaths: [],
    scopePaths: [`packages/cli/src/commands/team/${taskId}.ts`],
    targetRepo: 'AI-Atomic-Framework',
    allowPlanningMirror: false
  };
}

function workerReport(taskId: string, overrides: Record<string, unknown> = {}) {
  return {
    schemaId: 'atm.teamWorkerReport.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'fixture' },
    reportId: `report-${taskId}`,
    taskId,
    workerActorId: `worker-${taskId.toLowerCase()}`,
    executionState: 'done',
    changedFiles: [`packages/cli/src/commands/team/${taskId}.ts`],
    validatorRuns: [{ command: 'npm run typecheck', passed: true }],
    deviations: [],
    metadata: { reportedAt: '2026-07-19T00:00:00.000Z', waveId: 'wave-real-worker' },
    ...overrides
  };
}

function testCoreWorkerRuntime() {
  const manifest = createWaveManifest({
    waveId: 'wave-real-worker',
    batchRunId: 'batch-real-worker',
    coordinatorActorId: 'coordinator-a',
    targetRepo: 'AI-Atomic-Framework',
    executor: 'local-lanes',
    sealedBaseSha: 'HEAD',
    tasks: [
      {
        taskId: 'TASK-REAL-A',
        waveId: 'wave-real-worker',
        targetRepo: 'AI-Atomic-Framework',
        surfaceFamily: 'cli',
        scopePaths: ['packages/cli/src/commands/team/TASK-REAL-A.ts'],
        validators: ['npm run typecheck'],
        dependencyReady: true
      },
      {
        taskId: 'TASK-REAL-B',
        waveId: 'wave-real-worker',
        targetRepo: 'AI-Atomic-Framework',
        surfaceFamily: 'cli',
        scopePaths: ['packages/cli/src/commands/team/TASK-REAL-B.ts'],
        validators: ['npm run typecheck'],
        dependencyReady: true
      }
    ],
    now: '2026-07-19T00:00:00.000Z'
  });

  const initial = buildTeamWorkerExecutionRuntime({ manifest, now: '2026-07-19T00:00:01.000Z' });
  assert.equal(initial.resultState, 'executing');
  assert.deepEqual(initial.missingWorkerReports, ['TASK-REAL-A', 'TASK-REAL-B']);
  assert.equal(initial.lanes.every((lane) => lane.workerCanCommitOrClose === false), true);
  assert.equal(initial.telemetrySummary.checkId, 'team.worker-lifecycle');

  const ready = buildTeamWorkerExecutionRuntime({
    manifest,
    workerReports: [workerReport('TASK-REAL-A') as any, workerReport('TASK-REAL-B') as any]
  });
  assert.equal(ready.resultState, 'ready-for-write');
  assert.deepEqual(ready.acceptedTaskIds, ['TASK-REAL-A', 'TASK-REAL-B']);

  const review = buildTeamWorkerExecutionRuntime({
    manifest,
    workerReports: [
      workerReport('TASK-REAL-A', {
        changedFiles: ['packages/cli/src/commands/team/TASK-REAL-A.ts', 'packages/core/src/out-of-scope.ts']
      }) as any
    ]
  });
  assert.equal(review.resultState, 'needs-review');
  assert.deepEqual(review.outOfScopeFindings[0].files, ['packages/core/src/out-of-scope.ts']);
}

async function testCliIngestionWritesRuntimeOnly() {
  const repo = initRepo();
  try {
    const tasks = [task('TASK-CLI-A'), task('TASK-CLI-B')];
    for (const entry of tasks) {
      writeJson(path.join(repo, entry.taskPath), {
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: entry.workItemId,
        title: entry.title,
        status: 'ready',
        targetRepo: 'AI-Atomic-Framework',
        closureAuthority: 'target_repo',
        scopePaths: entry.scopePaths,
        deliverables: entry.scopePaths,
        validators: ['npm run typecheck']
      });
    }
    const queue = createOrRefreshTaskQueue({
      cwd: repo,
      sourcePrompt: 'real team wave worker fixture',
      tasks,
      actorId: 'coordinator-a',
      taskIds: tasks.map((entry) => entry.workItemId)
    });
    const batchRun = writeBatchRun({
      cwd: repo,
      sourcePrompt: 'real team wave worker fixture',
      tasks,
      queue,
      actorId: 'coordinator-a'
    });
    createOrRefreshTaskQueue({
      cwd: repo,
      sourcePrompt: 'real team wave worker fixture',
      tasks,
      actorId: 'coordinator-a',
      taskIds: tasks.map((entry) => entry.workItemId),
      batchId: batchRun.batchId,
      scopeKey: batchRun.scopeKey
    });

    const reportA = path.join(repo, 'report-a.json');
    const reportB = path.join(repo, 'report-b.json');
    writeJson(reportA, workerReport('TASK-CLI-A'));
    writeJson(reportB, workerReport('TASK-CLI-B'));
    const result = await runTeam(['wave', 'dispatch', '--cwd', repo, '--batch', batchRun.batchId, '--wave', 'wave-real-worker', '--executor', 'local-lanes', '--actor', 'coordinator-a', '--worker-report', reportA, '--worker-report', reportB, '--json']);
    assert.equal(result.ok, true);
    const runtime = (result.evidence as any).waveRuntime;
    assert.equal(runtime.workerExecution.schemaId, 'atm.teamWorkerExecutionRuntime.v1');
    assert.equal(runtime.resultState, 'ready-for-write');
    assert.equal(runtime.writesPerformed, false);
    assert.equal(existsSync(path.join(repo, '.atm/runtime/team-waves/wave-real-worker.json')), true);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

testCoreWorkerRuntime();
await testCliIngestionWritesRuntimeOnly();

console.log('[real-team-wave-worker-executor.test] ok');

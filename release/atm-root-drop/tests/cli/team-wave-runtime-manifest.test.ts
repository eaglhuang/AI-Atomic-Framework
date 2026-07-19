import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runTeam } from '../../packages/cli/src/commands/team.ts';
import { createOrRefreshTaskQueue, type TaskDirectionTask } from '../../packages/cli/src/commands/task-direction.ts';
import { writeBatchRun } from '../../packages/cli/src/commands/work-channels.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function task(taskId: string, scopePaths = [`packages/cli/src/commands/team/${taskId}.ts`]): TaskDirectionTask {
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
    closureAuthority: 'target_repo',
    scopePaths: entry.scopePaths,
    deliverables: entry.scopePaths,
    validators: ['npm run typecheck'],
    ...overrides
  });
}

function initRepo() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'team-wave-runtime-'));
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'team-wave-runtime'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'team-wave-runtime@example.test'], { cwd: repo, stdio: 'ignore' });
  writeFileSync(path.join(repo, 'README.md'), 'team wave runtime fixture\n', 'utf8');
  execFileSync('git', ['add', 'README.md'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
  return repo;
}

function buildBatchFixture(tasks: readonly TaskDirectionTask[]) {
  const repo = initRepo();
  const queue = createOrRefreshTaskQueue({
    cwd: repo,
    sourcePrompt: 'team wave runtime fixture',
    tasks,
    actorId: 'validator',
    taskIds: tasks.map((entry) => entry.workItemId)
  });
  const batchRun = writeBatchRun({
    cwd: repo,
    sourcePrompt: 'team wave runtime fixture',
    tasks,
    queue,
    actorId: 'validator'
  });
  createOrRefreshTaskQueue({
    cwd: repo,
    sourcePrompt: 'team wave runtime fixture',
    tasks,
    actorId: 'validator',
    taskIds: tasks.map((entry) => entry.workItemId),
    batchId: batchRun.batchId,
    scopeKey: batchRun.scopeKey
  });
  for (const entry of tasks) writeTaskRecord(repo, entry);
  return { repo, batchRun };
}

async function testManifestDispatch() {
  const tasks = [task('TASK-WAVE-RUNTIME-A'), task('TASK-WAVE-RUNTIME-B')];
  const { repo, batchRun } = buildBatchFixture(tasks);
  try {
    const result = await runTeam(['wave', 'dispatch', '--cwd', repo, '--batch', batchRun.batchId, '--wave', 'wave-runtime-fixture', '--executor', 'local-lanes', '--actor', 'coordinator-a', '--json']);
    assert.equal(result.ok, true);
    const runtime = (result.evidence as any).waveRuntime;
    assert.equal(runtime.schemaId, 'atm.teamWaveRuntime.v1');
    assert.equal(runtime.manifest.schemaId, 'atm.waveManifest.v1');
    assert.deepEqual(runtime.taskIds, ['TASK-WAVE-RUNTIME-A', 'TASK-WAVE-RUNTIME-B']);
    assert.deepEqual(runtime.lanes.map((lane: any) => lane.workerCanCommitOrClose), [false, false]);
    assert.equal(runtime.resultState, 'executing');
    assert.deepEqual(runtime.missingWorkerReports, ['TASK-WAVE-RUNTIME-A', 'TASK-WAVE-RUNTIME-B']);
    assert.equal(existsSync(path.join(repo, '.atm/runtime/team-waves/wave-runtime-fixture.json')), true);
    const dirty = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8' });
    assert.match(dirty, /\.atm\/runtime\/team-waves\/wave-runtime-fixture\.json/);

    const reportA = path.join(repo, 'report-a.json');
    const reportB = path.join(repo, 'report-b.json');
    writeJson(reportA, {
      schemaId: 'atm.teamWorkerReport.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'fixture' },
      reportId: 'report-a',
      taskId: 'TASK-WAVE-RUNTIME-A',
      workerActorId: 'worker-a',
      executionState: 'done',
      changedFiles: ['packages/cli/src/commands/team/TASK-WAVE-RUNTIME-A.ts'],
      validatorRuns: [{ command: 'npm run typecheck', passed: true }],
      deviations: [],
      metadata: { reportedAt: '2026-07-18T00:00:00.000Z', waveId: 'wave-runtime-fixture' }
    });
    writeJson(reportB, {
      schemaId: 'atm.teamWorkerReport.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'fixture' },
      reportId: 'report-b',
      taskId: 'TASK-WAVE-RUNTIME-B',
      workerActorId: 'worker-b',
      executionState: 'done',
      changedFiles: ['packages/cli/src/commands/team/TASK-WAVE-RUNTIME-B.ts'],
      validatorRuns: [{ command: 'npm run typecheck', passed: true }],
      deviations: [],
      metadata: { reportedAt: '2026-07-18T00:01:00.000Z', waveId: 'wave-runtime-fixture' }
    });
    const ready = await runTeam(['wave', 'dispatch', '--cwd', repo, '--batch', batchRun.batchId, '--wave', 'wave-runtime-fixture', '--executor', 'local-lanes', '--actor', 'coordinator-a', '--worker-report', reportA, '--worker-report', reportB, '--json']);
    assert.equal(ready.ok, true);
    assert.equal((ready.evidence as any).waveRuntime.resultState, 'ready-for-write');
    assert.deepEqual((ready.evidence as any).waveRuntime.acceptedTaskIds, ['TASK-WAVE-RUNTIME-A', 'TASK-WAVE-RUNTIME-B']);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

async function testOutOfScopeAndPartialFallback() {
  const tasks = [task('TASK-WAVE-RUNTIME-C'), task('TASK-WAVE-RUNTIME-D')];
  const { repo, batchRun } = buildBatchFixture(tasks);
  try {
    const badReport = path.join(repo, 'bad-report.json');
    writeJson(badReport, {
      schemaId: 'atm.teamWorkerReport.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'fixture' },
      reportId: 'bad-report',
      taskId: 'TASK-WAVE-RUNTIME-C',
      workerActorId: 'worker-c',
      executionState: 'done',
      changedFiles: ['packages/cli/src/commands/team/TASK-WAVE-RUNTIME-C.ts', 'packages/core/src/out-of-scope.ts'],
      validatorRuns: [{ command: 'npm run typecheck', passed: true }],
      deviations: [],
      metadata: { reportedAt: '2026-07-18T00:00:00.000Z', waveId: 'wave-runtime-review' }
    });
    const review = await runTeam(['wave', 'dispatch', '--cwd', repo, '--batch', batchRun.batchId, '--wave', 'wave-runtime-review', '--worker-report', badReport, '--json']);
    assert.equal(review.ok, false);
    assert.equal((review.evidence as any).waveRuntime.resultState, 'needs-review');
    assert.deepEqual((review.evidence as any).waveRuntime.outOfScopeFindings[0].files, ['packages/core/src/out-of-scope.ts']);

    const partialReport = path.join(repo, 'partial-report.json');
    writeJson(partialReport, {
      schemaId: 'atm.teamWorkerReport.v1',
      specVersion: '0.1.0',
      migration: { strategy: 'none', fromVersion: null, notes: 'fixture' },
      reportId: 'partial-report',
      taskId: 'TASK-WAVE-RUNTIME-C',
      workerActorId: 'worker-c',
      executionState: 'partial',
      changedFiles: ['packages/cli/src/commands/team/TASK-WAVE-RUNTIME-C.ts'],
      validatorRuns: [{ command: 'npm run typecheck', passed: true }],
      deviations: ['fixture partial'],
      metadata: { reportedAt: '2026-07-18T00:00:00.000Z', waveId: 'wave-runtime-partial' }
    });
    const partial = await runTeam(['wave', 'dispatch', '--cwd', repo, '--batch', batchRun.batchId, '--wave', 'wave-runtime-partial', '--worker-report', partialReport, '--json']);
    assert.equal(partial.ok, true);
    assert.equal((partial.evidence as any).waveRuntime.resultState, 'serial-fallback');
    assert.deepEqual((partial.evidence as any).waveRuntime.deferredTaskIds, ['TASK-WAVE-RUNTIME-C']);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

await testManifestDispatch();
await testOutOfScopeAndPartialFallback();

console.log('[team-wave-runtime-manifest.test] ok');

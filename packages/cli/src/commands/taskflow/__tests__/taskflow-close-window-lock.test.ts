import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../../shared.ts';
import {
  acquireCloseWindowStagedIndexLock,
  assertCloseWindowStagingAllowed,
  inspectForeignStagedTasksForCloseWindow,
  readCloseWindowStagedIndexLockReport,
  releaseCloseWindowStagedIndexLock
} from '../../tasks/close-window-lock.ts';
import {
  buildCloseWriteRollbackSnapshot,
  rollbackCloseWriteTransaction
} from '../close-orchestration.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function initGitRepo(repoRoot: string) {
  mkdirSync(repoRoot, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Fixture'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: repoRoot, stdio: 'ignore' });
}

function stageGovernanceFile(repoRoot: string, taskId: string, suffix = 'json') {
  const relativePath = `.atm/history/tasks/${taskId}.${suffix}`;
  writeJson(path.join(repoRoot, relativePath), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: `${taskId} fixture`,
    status: 'running'
  });
  execFileSync('git', ['add', relativePath], { cwd: repoRoot, stdio: 'ignore' });
  return relativePath;
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-close-window-lock-'));
const repoRoot = path.join(tempRoot, 'target');

try {
  initGitRepo(repoRoot);
  writeJson(path.join(repoRoot, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });
  execFileSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'bootstrap'], { cwd: repoRoot, stdio: 'ignore' });

  const taskId = 'TASK-CLOSE-WINDOW-0001';
  const foreignTaskId = 'TASK-FOREIGN-0002';
  const expectedStageFile = stageGovernanceFile(repoRoot, taskId);
  const foreignStageFile = stageGovernanceFile(repoRoot, foreignTaskId);

  const foreignOnly = inspectForeignStagedTasksForCloseWindow({
    cwd: repoRoot,
    taskId,
    expectedStageFiles: [expectedStageFile]
  });
  assert.equal(foreignOnly.length, 1);
  assert.equal(foreignOnly[0]?.taskId, foreignTaskId);
  assert.match(foreignOnly[0]?.restoreChoice ?? '', /--defer-foreign-staged/);

  const blocked = acquireCloseWindowStagedIndexLock({
    cwd: repoRoot,
    taskId,
    actorId: 'fixture-agent',
    expectedStageFiles: [expectedStageFile]
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.blockedCode, 'ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS');

  execFileSync('git', ['restore', '--staged', '--', foreignStageFile], { cwd: repoRoot, stdio: 'ignore' });

  const acquired = acquireCloseWindowStagedIndexLock({
    cwd: repoRoot,
    taskId,
    actorId: 'fixture-agent',
    expectedStageFiles: [expectedStageFile]
  });
  assert.equal(acquired.ok, true);
  assert.ok(existsSync(path.join(repoRoot, '.atm/runtime/locks/close-window-staged-index.lock.json')));

  const competing = acquireCloseWindowStagedIndexLock({
    cwd: repoRoot,
    taskId: foreignTaskId,
    actorId: 'other-agent',
    expectedStageFiles: [foreignStageFile]
  });
  assert.equal(competing.ok, false);
  assert.equal(competing.blockedCode, 'ATM_CLOSE_WINDOW_STAGED_INDEX_LOCKED');

  assert.throws(
    () => assertCloseWindowStagingAllowed({
      cwd: repoRoot,
      taskId: foreignTaskId,
      operation: 'stageRepoBundle'
    }),
    (error: unknown) => error instanceof CliError && error.code === 'ATM_CLOSE_WINDOW_STAGED_INDEX_LOCKED'
  );

  const released = releaseCloseWindowStagedIndexLock({
    cwd: repoRoot,
    taskId,
    actorId: 'fixture-agent',
    outcome: 'committed'
  });
  assert.equal(released?.status, 'released');
  assert.equal(released?.releaseOutcome, 'committed');
  assert.equal(readCloseWindowStagedIndexLockReport(repoRoot), null);

  execFileSync('git', ['add', foreignStageFile], { cwd: repoRoot, stdio: 'ignore' });
  const deferred = acquireCloseWindowStagedIndexLock({
    cwd: repoRoot,
    taskId,
    actorId: 'fixture-agent',
    expectedStageFiles: [expectedStageFile],
    deferForeignStaged: true
  });
  assert.equal(deferred.ok, true);
  assert.ok(deferred.foreignStagedSnapshotPath);
  assert.ok(existsSync(path.join(repoRoot, deferred.foreignStagedSnapshotPath!)));

  const stagedAfterDefer = execFileSync('git', ['diff', '--cached', '--name-only'], {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim().split(/\r?\n/).filter(Boolean);
  assert.deepEqual(stagedAfterDefer, [expectedStageFile]);

  releaseCloseWindowStagedIndexLock({
    cwd: repoRoot,
    taskId,
    actorId: 'fixture-agent',
    outcome: 'aborted'
  });
  assert.equal(existsSync(path.join(repoRoot, deferred.foreignStagedSnapshotPath!)), false, 'close-window deferred snapshot must be auto-cleaned when the lock releases');

  const previousTaskContent = readFileSync(path.join(repoRoot, `.atm/history/tasks/${taskId}.json`), 'utf8');
  writeJson(path.join(repoRoot, `.atm/history/tasks/${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'mutated during close',
    status: 'done'
  });
  execFileSync('git', ['add', `.atm/history/tasks/${taskId}.json`], { cwd: repoRoot, stdio: 'ignore' });

  acquireCloseWindowStagedIndexLock({
    cwd: repoRoot,
    taskId,
    actorId: 'fixture-agent',
    expectedStageFiles: [`.atm/history/tasks/${taskId}.json`]
  });

  const rollbackSnapshot = buildCloseWriteRollbackSnapshot({
    cwd: repoRoot,
    taskId,
    previousTaskContent,
    backendEvidence: {},
    planningCard: null,
    closeWindowStagedIndexLockActive: true
  });
  const rollback = rollbackCloseWriteTransaction({
    cwd: repoRoot,
    taskId,
    actorId: 'fixture-agent',
    snapshot: rollbackSnapshot,
    failureStep: 'commit-bundle',
    failureCode: 'ATM_TASKFLOW_CLOSE_COMMIT_BUNDLE_FAILED'
  });
  assert.equal(rollback.phase, 'rolled_back');
  assert.ok(rollback.rolledBackArtifacts.some((entry) => entry.includes('close-window-staged-index.lock.json')));
  assert.equal(readCloseWindowStagedIndexLockReport(repoRoot), null);
  assert.equal(
    readFileSync(path.join(repoRoot, `.atm/history/tasks/${taskId}.json`), 'utf8'),
    previousTaskContent
  );

  console.log('taskflow-close-window-lock.test.ts: all assertions passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

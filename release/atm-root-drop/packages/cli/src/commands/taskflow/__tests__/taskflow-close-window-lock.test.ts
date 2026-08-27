import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../../shared.ts';
import {
  acquireCloseWindowStagedIndexLock,
  assertCloseWindowStagingAllowed,
  inspectForeignStagedTasksForCloseWindow,
  readCloseWindowStagedIndexLockReport,
  releaseCloseWindowStagedIndexLock,
  runGitIndexMutationWithRetry
} from '../../tasks/close-window-lock.ts';
import {
  buildCloseWriteRollbackSnapshot,
  rollbackCloseWriteTransaction
} from '../close-orchestration.ts';
import { chunkGitPathspecs } from '../commit-bundle-assembly.ts';

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
  const longPathspecs = Array.from({ length: 200 }, (_, index) => `release/atm-root-drop/${String(index).padStart(4, '0')}/${'nested-path/'.repeat(20)}generated-file.ts`);
  const pathspecChunks = chunkGitPathspecs(longPathspecs);
  assert.ok(pathspecChunks.length > 1, 'large release bundles must be split before reaching the host argv ceiling');
  assert.deepEqual(pathspecChunks.flat(), longPathspecs, 'chunking must preserve every path exactly once and in order');
  assert.ok(pathspecChunks.every((chunk) => Buffer.byteLength(chunk.join('\0'), 'utf8') < 8_000), 'each pathspec chunk must stay inside the conservative argv budget');
  initGitRepo(repoRoot);
  writeJson(path.join(repoRoot, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });
  execFileSync('git', ['add', '.'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'bootstrap'], { cwd: repoRoot, stdio: 'ignore' });

  let transientIndexLockAttempts = 0;
  runGitIndexMutationWithRetry({
    cwd: repoRoot,
    args: ['update-index', '--add'],
    operation: 'fixture transient index mutation',
    run: () => {
      transientIndexLockAttempts += 1;
      if (transientIndexLockAttempts === 1) {
        throw new Error("fatal: Unable to create 'fixture/.git/index.lock': File exists.");
      }
    }
  });
  assert.equal(transientIndexLockAttempts, 2, 'a short-lived index lock must retry the same mutation once');

  const taskId = 'TASK-CLOSE-WINDOW-0001';
  const foreignTaskId = 'TASK-FOREIGN-0002';
  const expectedStageFile = stageGovernanceFile(repoRoot, taskId);
  const foreignStageFile = stageGovernanceFile(repoRoot, foreignTaskId);
  // Index ownership deliberately trusts a direction lock only when it has a
  // matching live claim.  Model a real foreign writer rather than a stale
  // lock-file residue, which must remain non-authoritative.
  writeJson(path.join(repoRoot, foreignStageFile), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: foreignTaskId,
    title: `${foreignTaskId} fixture`,
    status: 'running',
    claim: {
      actorId: 'foreign-agent',
      leaseId: 'lease-foreign-live',
      claimedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      ttlSeconds: 3600,
      files: [foreignStageFile],
      state: 'active'
    }
  });
  execFileSync('git', ['add', foreignStageFile], { cwd: repoRoot, stdio: 'ignore' });
  writeJson(path.join(repoRoot, '.atm/runtime/locks', `${foreignTaskId}.lock.json`), {
    schemaId: 'atm.governanceScopeLock',
    workItemId: foreignTaskId,
    lockedBy: 'foreign-agent',
    taskDirectionLock: {
      schemaId: 'atm.taskDirectionLock.v1',
      taskId: foreignTaskId,
      actorId: 'foreign-agent',
      status: 'active',
      allowedFiles: [foreignStageFile]
    }
  });

  const foreignOnly = inspectForeignStagedTasksForCloseWindow({
    cwd: repoRoot,
    taskId,
    expectedStageFiles: [expectedStageFile]
  });
  assert.equal(foreignOnly.length, 1);
  assert.equal(foreignOnly[0]?.taskId, foreignTaskId);
  assert.match(foreignOnly[0]?.deferCommand ?? '', /git lease stage-override/);

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

  const handedOff = acquireCloseWindowStagedIndexLock({
    cwd: repoRoot,
    taskId: 'TASK-CLOSE-0002',
    actorId: 'second-agent',
    expectedStageFiles: [],
    waitForHandoff: true,
    maxHandoffWaitMs: 1_000,
    waitForHandoffPoll: () => {
      releaseCloseWindowStagedIndexLock({ cwd: repoRoot, taskId, actorId: 'fixture-agent', outcome: 'committed' });
      execFileSync('git', ['restore', '--staged', '--', expectedStageFile], { cwd: repoRoot, stdio: 'ignore' });
    }
  });
  assert.equal(handedOff.ok, true);
  assert.equal(handedOff.lock?.taskId, 'TASK-CLOSE-0002');
  assert.equal(handedOff.handoffWait?.waitedForTaskId, taskId);
  assert.equal(handedOff.handoffWait?.disposition, 'acquired-after-release');
  releaseCloseWindowStagedIndexLock({ cwd: repoRoot, taskId: 'TASK-CLOSE-0002', actorId: 'second-agent', outcome: 'committed' });
  execFileSync('git', ['add', '--', expectedStageFile], { cwd: repoRoot, stdio: 'ignore' });

  acquireCloseWindowStagedIndexLock({ cwd: repoRoot, taskId, actorId: 'fixture-agent', expectedStageFiles: [expectedStageFile] });

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
  const stagedAfterRelease = execFileSync('git', ['diff', '--cached', '--name-only'], {
    cwd: repoRoot,
    encoding: 'utf8'
  }).trim().split(/\r?\n/).filter(Boolean).sort();
  assert.deepEqual(stagedAfterRelease, [expectedStageFile, foreignStageFile].sort(), 'releasing a deferred close window must restore the foreign staged entry');
  assert.equal(existsSync(path.join(repoRoot, deferred.foreignStagedSnapshotPath!)), false, 'close-window deferred snapshot must be auto-cleaned when the lock releases');
  execFileSync('git', ['restore', '--staged', '--', foreignStageFile], { cwd: repoRoot, stdio: 'ignore' });

  // A staged deletion has no ls-files entry. It is still a real foreign index
  // fact and must survive a deferred close exactly like an added or modified
  // blob; treating its absence as an incomplete snapshot deadlocks closeout.
  const foreignDeletionFile = 'foreign-deletion.txt';
  writeFileSync(path.join(repoRoot, foreignDeletionFile), 'baseline\n', 'utf8');
  execFileSync('git', ['add', '--', foreignDeletionFile], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'foreign deletion baseline'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['rm', '--cached', '--', foreignDeletionFile], { cwd: repoRoot, stdio: 'ignore' });
  const deletionDeferred = acquireCloseWindowStagedIndexLock({
    cwd: repoRoot,
    taskId,
    actorId: 'fixture-agent',
    expectedStageFiles: [expectedStageFile],
    deferForeignStaged: true
  });
  assert.equal(deletionDeferred.ok, true);
  assert.deepEqual(deletionDeferred.lock?.foreignStagedEntries, [{ path: foreignDeletionFile, mode: null, blobId: null }]);
  assert.equal(execFileSync('git', ['diff', '--cached', '--name-only', '--', foreignDeletionFile], { cwd: repoRoot, encoding: 'utf8' }).trim(), '');
  releaseCloseWindowStagedIndexLock({ cwd: repoRoot, taskId, actorId: 'fixture-agent', outcome: 'aborted' });
  assert.equal(execFileSync('git', ['diff', '--cached', '--name-only', '--', foreignDeletionFile], { cwd: repoRoot, encoding: 'utf8' }).trim(), foreignDeletionFile);
  execFileSync('git', ['restore', '--staged', '--', foreignDeletionFile], { cwd: repoRoot, stdio: 'ignore' });

  execFileSync('git', ['add', foreignStageFile], { cwd: repoRoot, stdio: 'ignore' });
  const recoveryDeferred = acquireCloseWindowStagedIndexLock({
    cwd: repoRoot,
    taskId,
    actorId: 'fixture-agent',
    expectedStageFiles: [expectedStageFile],
    deferForeignStaged: true
  });
  assert.equal(recoveryDeferred.ok, true);
  const recoverySnapshotPath = path.join(repoRoot, recoveryDeferred.foreignStagedSnapshotPath!);
  unlinkSync(recoverySnapshotPath);
  releaseCloseWindowStagedIndexLock({
    cwd: repoRoot,
    taskId,
    actorId: 'fixture-agent',
    outcome: 'aborted'
  });
  assert.equal(existsSync(recoverySnapshotPath), false, 'the external snapshot is advisory; the active lock retains the verified restore identity');
  execFileSync('git', ['restore', '--staged', '--', foreignStageFile], { cwd: repoRoot, stdio: 'ignore' });

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

  const transitionId = '2026-08-12T00-00-00-000Z-close-rollback-fixture';
  writeJson(path.join(repoRoot, `.atm/history/tasks/${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    status: 'done',
    lastTransitionId: transitionId
  });
  const transitionPath = path.join(repoRoot, '.atm', 'history', 'task-events', taskId, `${transitionId}.json`);
  writeJson(transitionPath, { taskId, action: 'close' });
  const derivedSnapshot = buildCloseWriteRollbackSnapshot({
    cwd: repoRoot,
    taskId,
    previousTaskContent,
    backendEvidence: {},
    planningCard: null
  });
  rollbackCloseWriteTransaction({
    cwd: repoRoot,
    taskId,
    actorId: 'fixture-agent',
    snapshot: derivedSnapshot,
    failureStep: 'commit-bundle',
    failureCode: 'ATM_TASKFLOW_CLOSE_COMMIT_BUNDLE_FAILED'
  });
  assert.equal(existsSync(transitionPath), false, 'rollback must remove the transition inferred from the mutated live ledger');

  console.log('taskflow-close-window-lock.test.ts: all assertions passed');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveTaskScopedCommitBundle, runAtmGit } from '../../../packages/cli/src/commands/git-governance.ts';
import { inspectGitIndexOwnership } from '../../../packages/cli/src/commands/git-index-ownership.ts';
import {
  executeTaskScopedCommitTransaction,
  TaskScopedCommitTransactionError,
  type TaskScopedCommitTransactionEntry
} from '../../../packages/cli/src/commands/git-governance/task-scoped-commit-transaction.ts';
import { runGit, tempDir, writeJson, type FixtureContext } from './fixture.ts';

type ScenarioContext = Pick<
  FixtureContext,
  'taskId' | 'foreignActiveTaskId' | 'scopedFile' | 'sessionId' | 'taskDocument'
>;

export async function runIndexLeaseTransactionScenarios(input: ScenarioContext) {
  const { taskId, foreignActiveTaskId, scopedFile, sessionId, taskDocument } = input;
  const foreignActiveFile = `.atm/history/evidence/${foreignActiveTaskId}.json`;
  mkdirSync(path.join(tempDir, path.dirname(foreignActiveFile)), { recursive: true });
  writeFileSync(
    path.join(tempDir, foreignActiveFile),
    `${JSON.stringify({ taskId: foreignActiveTaskId, evidence: [] }, null, 2)}\n`,
    'utf8'
  );
  writeJson(path.join(tempDir, `.atm/history/tasks/${foreignActiveTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: foreignActiveTaskId,
    status: 'running',
    claim: {
      actorId: 'other-agent',
      leaseId: 'lease-foreign-active',
      state: 'active',
      files: [foreignActiveFile]
    }
  });
  writeJson(path.join(tempDir, `.atm/runtime/locks/${foreignActiveTaskId}.lock.json`), {
    schemaId: 'atm.governanceScopeLock',
    specVersion: '0.1.0',
    workItemId: foreignActiveTaskId,
    lockedBy: 'other-agent',
    actorId: 'other-agent',
    leaseId: 'lease-foreign-active',
    lockedAt: '2026-06-18T00:00:00.000Z',
    heartbeatAt: '2026-06-18T00:00:00.000Z',
    ttlSeconds: 999999999,
    status: 'active',
    files: [foreignActiveFile],
    taskDirectionLock: {
      schemaId: 'atm.taskDirectionLock.v1',
      specVersion: '0.1.0',
      taskId: foreignActiveTaskId,
      batchId: null,
      scopeKey: null,
      queueId: null,
      queueIndex: null,
      allowedFiles: [foreignActiveFile],
      planningReadOnlyPaths: [],
      planningMirrorPaths: [],
      allowPlanningMirror: false,
      promptHash: null,
      actorId: 'other-agent',
      sessionId: 'session-foreign-active',
      createdAt: '2026-06-18T00:00:00.000Z',
      status: 'active'
    }
  });
  writeJson(path.join(tempDir, '.atm/runtime/sessions/session-foreign-active.json'), {
    schemaId: 'atm.actorWorkSession.v1',
    specVersion: '0.1.0',
    sessionId: 'session-foreign-active',
    actorId: 'other-agent',
    taskId: foreignActiveTaskId,
    claimLeaseId: 'lease-foreign-active',
    status: 'active',
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z',
    heartbeatAt: '2026-06-18T00:00:00.000Z',
    taskPath: `.atm/history/tasks/${foreignActiveTaskId}.json`,
    sourcePrompt: null,
    batchId: null,
    guidanceSessionId: null,
    editor: 'codex',
    gitName: 'Other Agent',
    gitEmail: 'other-agent@example.invalid'
  });
  runGit(tempDir, ['add', foreignActiveFile]);

  const ownership = inspectGitIndexOwnership({ cwd: tempDir, taskId, stagedFiles: [foreignActiveFile] });
  assert.equal(ownership.indexLane.status, 'blocked-foreign-active-staged');
  assert.equal(ownership.foreignActiveStaged[0]?.ownerTaskId, foreignActiveTaskId);
  assert.equal(ownership.foreignActiveStaged[0]?.ownerActorId, 'other-agent');
  assert.equal(ownership.foreignActiveStaged[0]?.ownerSessionId, 'session-foreign-active');
  assert.equal(ownership.indexLane.ownerSessionId, 'session-foreign-active');

  const foreignActiveBundle = resolveTaskScopedCommitBundle({
    cwd: tempDir,
    taskId,
    taskDocument,
    apply: false,
    autoStage: false,
    deferForeignStaged: true,
    message: 'feat: refuse foreign active defer',
    actorId: 'fixture-agent',
    trailers: []
  });
  assert.equal(foreignActiveBundle.ok, false);
  assert.equal(foreignActiveBundle.blockedCode, 'ATM_INDEX_FOREIGN_ACTIVE_STAGED');
  assert.equal(foreignActiveBundle.gitIndexOwnership.indexLane.status, 'blocked-foreign-active-staged');
  assert.equal(foreignActiveBundle.gitIndexOwnership.indexLane.ownerSessionId, 'session-foreign-active');

  const stageOverrideLease = await runAtmGit([
    'lease',
    'stage-override',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--paths', foreignActiveFile,
    '--reason', 'Human approved fixture-only staged index lease.',
    '--json'
  ]) as any;
  assert.equal(stageOverrideLease.ok, true);
  assert.equal(stageOverrideLease.evidence.lease.chatTextAccepted, false);
  assert.equal(stageOverrideLease.evidence.lease.kind, 'stage-override');
  assert.equal(existsSync(path.join(tempDir, stageOverrideLease.evidence.leasePath)), true);

  const foreignIndexBefore = runGit(tempDir, ['ls-files', '-s', '--', foreignActiveFile]).trim();
  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "leased-foreign-index";\n', 'utf8');
  const authorizedForeignBundle = resolveTaskScopedCommitBundle({
    cwd: tempDir,
    taskId,
    taskDocument,
    apply: false,
    autoStage: true,
    deferForeignStaged: true,
    stageOverrideLease: stageOverrideLease.evidence.lease.leaseId,
    message: 'feat: commit beside leased foreign index',
    actorId: 'fixture-agent',
    trailers: [`ATM-Actor: fixture-agent`, `ATM-Task: ${taskId}`]
  });
  assert.equal(authorizedForeignBundle.ok, true);
  assert.equal(authorizedForeignBundle.indexLeaseAuthorization?.ok, true);

  const leasedCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: commit beside leased foreign index',
    '--auto-stage',
    '--defer-foreign-staged',
    '--stage-override-lease', stageOverrideLease.evidence.lease.leaseId,
    '--json'
  ]);
  assert.equal(leasedCommit.ok, true);
  assert.equal(runGit(tempDir, ['show', '--name-only', '--format=', 'HEAD']).includes(scopedFile), true);
  assert.equal(runGit(tempDir, ['show', '--name-only', '--format=', 'HEAD']).includes(foreignActiveFile), false);
  assert.equal(runGit(tempDir, ['ls-files', '-s', '--', foreignActiveFile]).trim(), foreignIndexBefore);
  const consumedLease = JSON.parse(readFileSync(path.join(tempDir, stageOverrideLease.evidence.leasePath), 'utf8'));
  assert.equal(consumedLease.used, true);

  const reusedLeaseBundle = resolveTaskScopedCommitBundle({
    cwd: tempDir,
    taskId,
    taskDocument,
    apply: false,
    autoStage: false,
    deferForeignStaged: true,
    stageOverrideLease: stageOverrideLease.evidence.lease.leaseId,
    message: 'feat: reject consumed foreign index lease',
    actorId: 'fixture-agent',
    trailers: []
  });
  assert.equal(reusedLeaseBundle.ok, false);
  assert.equal(reusedLeaseBundle.blockedCode, 'ATM_INDEX_FOREIGN_ACTIVE_STAGED');
  assert.equal(runGit(tempDir, ['ls-files', '-s', '--', foreignActiveFile]).trim(), foreignIndexBefore);

  assertTransactionPortContract();
}

export function assertTransactionPortContract() {
  const entries: readonly TaskScopedCommitTransactionEntry[] = [
    { path: 'src/foreign.ts', mode: '100755', blobId: 'abc123' }
  ];
  const events: string[] = [];
  const success = executeTaskScopedCommitTransaction(
    { taskId: 'TASK-RFT-0101', leaseId: 'lease-success', foreignEntries: entries },
    {
      park(received) {
        assert.deepEqual(received, entries);
        events.push('park');
      },
      commitCurrentTaskBundle() {
        events.push('commit');
        return 'commit-sha';
      },
      restore(received) {
        assert.deepEqual(received, entries);
        events.push('restore');
      },
      recordRestoreFailure() {
        assert.fail('success must not record a restore failure');
      }
    }
  );
  assert.deepEqual(events, ['park', 'commit', 'restore']);
  assert.equal(success.value, 'commit-sha');
  assert.deepEqual(success.restoredEntries, entries);

  let commitFailureObserved = false;
  let commitFailureRestored: readonly TaskScopedCommitTransactionEntry[] = [];
  try {
    executeTaskScopedCommitTransaction(
      { taskId: 'TASK-RFT-0101', leaseId: 'lease-commit-failure', foreignEntries: entries },
      {
        park() {},
        commitCurrentTaskBundle() {
          throw undefined;
        },
        restore(received) {
          commitFailureRestored = received;
        },
        recordRestoreFailure() {
          assert.fail('successful restore must not record a failure');
        }
      }
    );
  } catch (error) {
    commitFailureObserved = true;
    assert.equal(error, undefined);
  }
  assert.equal(commitFailureObserved, true);
  assert.deepEqual(commitFailureRestored, entries);

  const commitError = new Error('commit failed');
  const restoreError = new Error('restore failed');
  let recordedFailure: unknown = null;
  assert.throws(
    () => executeTaskScopedCommitTransaction(
      { taskId: 'TASK-RFT-0101', leaseId: 'lease-restore-failure', foreignEntries: entries },
      {
        park() {},
        commitCurrentTaskBundle() {
          throw commitError;
        },
        restore() {
          throw restoreError;
        },
        recordRestoreFailure(input) {
          recordedFailure = input;
        }
      }
    ),
    (error: unknown) => {
      assert.ok(error instanceof TaskScopedCommitTransactionError);
      assert.equal(error.code, 'ATM_GIT_INDEX_RESTORE_FAILED');
      assert.equal(error.commitError, commitError);
      assert.equal(error.restoreError, restoreError);
      return true;
    }
  );
  assert.deepEqual(recordedFailure, {
    taskId: 'TASK-RFT-0101',
    leaseId: 'lease-restore-failure',
    entries,
    commitError,
    restoreError
  });
}

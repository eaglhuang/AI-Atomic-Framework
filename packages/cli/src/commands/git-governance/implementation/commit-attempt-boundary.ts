import { consumeGitIndexOverrideLease, parkGitIndexLease, restoreGitIndexLease } from '../../git-index-ownership.ts';
import { executeTaskScopedCommitTransaction } from '../task-scoped-commit-transaction.ts';
import { executeHookBypassCommitBoundary } from './hook-bypass-commit-boundary.ts';
import { writeGitCommitAttemptStatus } from './git-process-port.ts';
import { recordGitIndexRestoreFailure, withTaskScopedCommitIndex } from './git-index-transaction.ts';
import { resolveGovernedCommitSeal } from './sealed-commit-attribution.ts';

type LegacyValue = ReturnType<typeof JSON.parse>;

export function executeCommitAttempt(input: LegacyValue): LegacyValue {
  let protectedOverrideAudit = input.protectedOverrideAudit;
  const runCommit = (env: LegacyValue) => {
    const boundary = executeHookBypassCommitBoundary({
      hookBypassRequest: input.hookBypassRequest,
      cwd: input.options.cwd,
      gitArgs: input.args,
      env,
      timeoutMs: input.commitTimeoutMs,
    });
    protectedOverrideAudit = boundary.protectedOverrideAudit;
    return boundary.value;
  };
  writeGitCommitAttemptStatus(input.options.cwd, input.commitAttemptStatusPath, {
    schemaId: 'atm.gitCommitAttemptStatus.v1',
    actorId: input.actorId,
    taskId: input.options.taskId,
    sessionId: input.session?.sessionId ?? null,
    laneSessionId: input.laneSessionId,
    status: 'in-progress',
    phase: 'running-git-commit',
    startedAt: input.commitAttemptStartedAt,
    updatedAt: new Date().toISOString(),
    commitSha: null,
    headShaBeforeCommit: input.headShaBeforeCommit,
    headShaAfterAttempt: null,
    headAdvancedDuringAttempt: null,
    timeoutMs: input.commitTimeoutMs,
    errorCode: null,
    errorSummary: null,
    statusCommand: input.statusCommand,
    retryCommand: input.retryCommand,
    copyableCommitCommand: input.rawCopyableCommitCommand,
    liveIndexResidueRollback: [],
  });
  const commitScopedBundle = () =>
    withTaskScopedCommitIndex(
      input.options.cwd,
      input.scopedCommitFiles.length > 0
        ? input.scopedCommitFiles
        : input.stagedCommitSurface,
      input.actorId,
      input.options.taskId,
      (scopedEnv: LegacyValue) => runCommit({ ...input.commitEnv, ...scopedEnv }),
      resolveGovernedCommitSeal({
        cwd: input.options.cwd,
        admittedBundle:
          input.scopedCommitFiles.length > 0
            ? (input.taskScopedBundleReport?.sealedBundle ?? null)
            : null,
        paths: input.stagedCommitSurface,
        provenance: 'pre-staged-index',
      }),
    );
  const indexLeaseAuthorization = input.taskScopedBundleReport?.indexLeaseAuthorization;
  if (indexLeaseAuthorization?.ok) {
    executeTaskScopedCommitTransaction(
      {
        taskId: input.options.taskId,
        leaseId: indexLeaseAuthorization.lease.leaseId,
        foreignEntries: indexLeaseAuthorization.plan.parkEntries.map((entry: LegacyValue) => ({
          path: entry.path,
          mode: String(entry.stagedMode ?? ''),
          blobId: String(entry.stagedBlobId ?? ''),
        })),
      },
      {
        park: () => parkGitIndexLease(input.options.cwd, indexLeaseAuthorization.plan),
        commitCurrentTaskBundle: commitScopedBundle,
        restore: () => restoreGitIndexLease(input.options.cwd, indexLeaseAuthorization.plan),
        recordRestoreFailure: (failure: LegacyValue) => {
          recordGitIndexRestoreFailure(input.options.cwd, failure);
        },
      },
    );
    consumeGitIndexOverrideLease(input.options.cwd, indexLeaseAuthorization.lease);
  } else {
    commitScopedBundle();
  }
  return protectedOverrideAudit;
}

import { consumeGitIndexOverrideLease, parkGitIndexLease, restoreGitIndexLease } from '../../git-index-ownership.js';
import { renewFrameworkTempClaim } from '../../tasks/renew-framework-temp.js';
import { executeTaskScopedCommitTransaction } from '../task-scoped-commit-transaction.js';
import * as hookBypassCommitBoundary from './hook-bypass-commit-boundary.js';
import { writeGitCommitAttemptStatus } from './git-process-port.js';
import { recordGitIndexRestoreFailure, withTaskScopedCommitIndex } from './git-index-transaction.js';
import { resolveGovernedCommitSeal } from './sealed-commit-attribution.js';
/** Same holder extension `tasks renew` applies to a live temporary claim.
 * Sealing a generation hashes the admitted tree before the commit hook reads
 * that claim again, and the default TTL can elapse in that interval. */
const SEAL_COMMIT_FRAMEWORK_TEMP_TTL_SECONDS = 14400;
export function renewFrameworkTempClaimForSealCommit(input) {
    if (!input.taskId?.startsWith('ATM-FRAMEWORK-TEMP-'))
        return;
    renewFrameworkTempClaim({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: input.actorId,
        ttlSeconds: SEAL_COMMIT_FRAMEWORK_TEMP_TTL_SECONDS,
    });
}
function frameworkTempTaskIdForSeal(input) {
    const fromEnv = typeof input.commitEnv?.ATM_COMMIT_TASK_ID === 'string' ? input.commitEnv.ATM_COMMIT_TASK_ID.trim() : '';
    const fromOptions = typeof input.options?.taskId === 'string' ? input.options.taskId.trim() : '';
    const taskId = fromEnv || fromOptions;
    return taskId.startsWith('ATM-FRAMEWORK-TEMP-') ? taskId : null;
}
/**
 * Preserve the wrapper's explicit attribution when an isolated candidate index
 * contributes its temporary Git environment. Candidate construction inherits
 * the process environment, so its ATM_COMMIT_* values are not authoritative.
 */
export function mergeCandidateCommitEnv(commitEnv, scopedEnv) {
    return { ...scopedEnv, ...commitEnv };
}
export function executeCommitAttempt(input) {
    renewFrameworkTempClaimForSealCommit({
        cwd: input.options.cwd,
        actorId: input.actorId,
        taskId: frameworkTempTaskIdForSeal(input),
    });
    let protectedOverrideAudit = input.protectedOverrideAudit;
    const runCommit = (env) => {
        const boundary = hookBypassCommitBoundary.executeHookBypassCommitBoundary({
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
    const commitScopedBundle = () => withTaskScopedCommitIndex(input.options.cwd, input.scopedCommitFiles.length > 0
        ? input.scopedCommitFiles
        : input.stagedCommitSurface, input.actorId, input.options.taskId, (scopedEnv) => runCommit(mergeCandidateCommitEnv(input.commitEnv, scopedEnv)), resolveGovernedCommitSeal({
        cwd: input.options.cwd,
        admittedBundle: input.scopedCommitFiles.length > 0
            ? (input.taskScopedBundleReport?.sealedBundle ?? null)
            : null,
        paths: input.stagedCommitSurface,
        provenance: 'pre-staged-index',
    }));
    const indexLeaseAuthorization = input.taskScopedBundleReport?.indexLeaseAuthorization;
    if (indexLeaseAuthorization?.ok) {
        executeTaskScopedCommitTransaction({
            taskId: input.options.taskId,
            leaseId: indexLeaseAuthorization.lease.leaseId,
            foreignEntries: indexLeaseAuthorization.plan.parkEntries.map((entry) => ({
                path: entry.path,
                mode: String(entry.stagedMode ?? ''),
                blobId: String(entry.stagedBlobId ?? ''),
            })),
        }, {
            park: () => parkGitIndexLease(input.options.cwd, indexLeaseAuthorization.plan),
            commitCurrentTaskBundle: commitScopedBundle,
            restore: () => restoreGitIndexLease(input.options.cwd, indexLeaseAuthorization.plan),
            recordRestoreFailure: (failure) => {
                recordGitIndexRestoreFailure(input.options.cwd, failure);
            },
        });
        consumeGitIndexOverrideLease(input.options.cwd, indexLeaseAuthorization.lease);
    }
    else {
        commitScopedBundle();
    }
    return protectedOverrideAudit;
}

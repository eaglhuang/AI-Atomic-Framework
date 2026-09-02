import {
  rollbackFailedGitHeadEvidencePreparation,
} from './git-head-evidence-transaction.ts';
import {
  assertNoStdinPathspecGitAddPreflight,
  createSanitizedGitEnv,
  gitCommitAttemptStatusRelativePath,
  readGitCommitAttemptStatus,
  resolveGitExecutable,
  resolveGitCommitTimeoutMs,
  writeGitCommitAttemptStatus,
} from './git-process-port.ts';
import {
  assertEmergencyApproval,
  recordProtectedOverrideOutcome,
} from "../../emergency/gate.ts";
import { buildProtectedOverrideRepairCandidate } from "../../emergency/protected-override-audit.ts";
import {
  ATM_INDEX_FOREIGN_ACTIVE_STAGED,
  authorizeGitIndexOverrideLease,
  buildForeignActiveStagedDiagnostic,
  inspectGitIndexOwnership,
} from "../../git-index-ownership.ts";
import {
  TaskScopedCommitTransactionError,
} from "../task-scoped-commit-transaction.ts";
import {
  extractGovernanceTaskIdFromPath,
  isProtectedStagedGovernanceOwnershipPath,
  normalizeRelativePath,
  normalizeTaskClaimIntent,
  pathMatchesTaskScope,
  uniqueSorted,
} from "../commit-scope-policy.ts";
import {
  CliError,
  makeResult,
  message,
  quoteCliValue,
  relativePathFrom,
} from "../../shared.ts";
import { withBranchCommitQueueLock } from './branch-commit-window.ts';
import { buildCopyableGitCommitCommand, buildHostGitCompatibilityGuidance, cleanupDeferredForeignStagedSnapshot, inspectCloseCommitWindowStagedArtifacts, rollbackNewlyStagedLiveIndexResidue } from './git-index-transaction.ts';
import {
  captureIndexRestorationSnapshot,
  restoreIndexToSnapshot,
  type IndexRestorationOutcome,
  type IndexRestorationSnapshot,
} from './index-restoration.ts';
import { isHeadRaceCommitFailure, readHeadBranchRef, readHeadCommitSha } from './push-command.ts';
import { prepareCommitCandidate, assertGovernedCommitPhysicalLineBudget } from './commit-candidate-preparation.ts';
import { executeCommitAttempt } from './commit-attempt-boundary.ts';
import { createHookFailureDiagnosticReport, summarizeHookFailure } from './hook-failure-diagnostics.ts';

type LegacyValue = ReturnType<typeof JSON.parse>;

export { assertGovernedCommitPhysicalLineBudget };

/**
 * After a commit attempt throws, roll the live index back only when HEAD did
 * not move. A landed commit has already advanced the ref; restoring the
 * pre-attempt snapshot would put parent blobs back into the shared index.
 */
export function applyLiveIndexRollbackAfterCommitError(input: {
  readonly cwd: string;
  readonly headAdvancedDuringAttempt: boolean;
  readonly indexRestorationSnapshot: IndexRestorationSnapshot | null;
  readonly liveIndexSnapshotBeforeAttempt: LegacyValue;
}): {
  readonly indexRestoration: IndexRestorationOutcome | null;
  readonly liveIndexResidueRollback: readonly string[];
} {
  if (input.headAdvancedDuringAttempt) {
    return { indexRestoration: null, liveIndexResidueRollback: [] };
  }
  const indexRestoration = input.indexRestorationSnapshot
    ? restoreIndexToSnapshot(input.cwd, input.indexRestorationSnapshot)
    : null;
  return {
    indexRestoration,
    liveIndexResidueRollback: Array.from(
      new Set([
        ...(indexRestoration?.restoredPaths ?? []),
        ...rollbackNewlyStagedLiveIndexResidue(
          input.cwd,
          input.liveIndexSnapshotBeforeAttempt,
        ),
      ]),
    ).sort(),
  };
}

export function executeGitCommit(options: LegacyValue, context: LegacyValue) {
let { actorId, args, autoStagedFrameworkPaths, branchName, branchRef, bypassesActiveSession, claimForTrailers, commitAttemptStartedAt, commitAttemptStatusPath, commitCommand, commitTimeoutMs, deferredForeignStagedSnapshotPath, frameworkClaimCommitFiles, gitEmail, gitHeadEvidenceSnapshotBeforeCommitAttempt, gitName, headShaAtCommitStart, headShaBeforeCommit, hookBypassRequest, hookTaskId, laneSessionId, liveIndexSnapshotBeforeCommitAttempt, profile, protectedOverrideAudit, protectedOverrideOutcome, rawCopyableCommitCommand, retryCommand, session, statusCommand, taskDocument, taskScopedBundleReport, trailers } = context;
// ATM-GOV-0369 amendment 1: the boundary that can fail owns its own
// pre-operation snapshot, so restoration never depends on a caller
// remembering to take one.
const indexRestorationSnapshotBeforeCommitAttempt = captureIndexRestorationSnapshot(options.cwd);
try {
    withBranchCommitQueueLock(
      {
        cwd: options.cwd,
        actorId,
        taskId: hookTaskId,
        sessionId: session?.sessionId ?? null,
        branchRef,
        branchName,
        headShaAtAcquire: headShaBeforeCommit,
        timeoutMs: commitTimeoutMs,
      },
      () => {
        headShaAtCommitStart = readHeadCommitSha(options.cwd);
        if (headShaAtCommitStart !== headShaBeforeCommit) {
          throw new CliError(
            "ATM_GIT_COMMIT_BRANCH_QUEUE_RACE",
            "Branch HEAD changed after queue admission and before commit start. Retry through the ATM commit lane.",
            {
              exitCode: 1,
              details: {
                actorId,
                taskId: options.taskId,
                sessionId: session?.sessionId ?? null,
                branchRef,
                branchName,
                headShaAtAcquire: headShaBeforeCommit,
                headShaAtCommitStart,
                retryable: true,
                requiredCommand: `node atm.mjs git commit --actor ${quoteCliValue(actorId)}${options.taskId ? ` --task ${quoteCliValue(options.taskId)}` : ""} --message ${quoteCliValue(options.message)}${options.noVerify ? " --no-verify" : ""} --json`,
              },
            },
          );
        }
        const commitEnv = createSanitizedGitEnv({
          GIT_AUTHOR_NAME: gitName,
          GIT_AUTHOR_EMAIL: gitEmail,
          GIT_COMMITTER_NAME: gitName,
          GIT_COMMITTER_EMAIL: gitEmail,
          ATM_COMMIT_ACTOR_ID: actorId,
          ATM_COMMIT_TASK_ID: hookTaskId ?? "",
          ATM_COMMIT_CLAIM_LEASE_ID: claimForTrailers?.leaseId ?? "",
          ATM_COMMIT_SESSION_ID: session?.sessionId ?? "",
          ATM_COMMIT_LANE_SESSION_ID: laneSessionId ?? "",
          ATM_COMMIT_INDEX_FINALIZED: "1",
          ATM_COMMIT_BROKER_CONFLICT_RESOLUTION:
            options.brokerConflictResolutionPath ?? "",
          ATM_COMMIT_TRAILERS: trailers.join("\n"),
        });
        const candidate = prepareCommitCandidate({
          options,
          taskDocument,
          taskScopedBundleReport,
          frameworkClaimCommitFiles,
          actorId,
          trailers,
          hookTaskId,
          autoStagedFrameworkPaths,
        });
        // executeHookBypassCommitBoundary( is reached inside executeCommitAttempt
        // only after withBranchCommitQueueLock admits this branch commit window.
        protectedOverrideAudit = executeCommitAttempt({
          options,
          actorId,
          args,
          commitEnv,
          commitTimeoutMs,
          hookBypassRequest,
          protectedOverrideAudit,
          commitAttemptStatusPath,
          commitAttemptStartedAt,
          session,
          laneSessionId,
          headShaBeforeCommit,
          statusCommand,
          retryCommand,
          rawCopyableCommitCommand,
          taskScopedBundleReport,
          ...candidate,
        });
      },
    );
  } catch (error) {
    cleanupDeferredForeignStagedSnapshot(
      options.cwd,
      deferredForeignStagedSnapshotPath,
    );
    const nodeChildError: LegacyValue = error;
    const isCommitTimeoutFailure = Boolean(
      nodeChildError &&
      (nodeChildError.code === "ETIMEDOUT" ||
        (nodeChildError.killed === true && Boolean(nodeChildError.signal))),
    );
    const headShaAfterFailure = readHeadCommitSha(options.cwd);
    const headAdvancedDuringAttempt = Boolean(
      headShaAfterFailure &&
      headShaBeforeCommit &&
      headShaAfterFailure !== headShaBeforeCommit,
    );
    const { liveIndexResidueRollback } = applyLiveIndexRollbackAfterCommitError({
      cwd: options.cwd,
      headAdvancedDuringAttempt,
      indexRestorationSnapshot: indexRestorationSnapshotBeforeCommitAttempt,
      liveIndexSnapshotBeforeAttempt: liveIndexSnapshotBeforeCommitAttempt,
    });
    const gitHeadEvidenceRollback = headAdvancedDuringAttempt
      ? false
      : rollbackFailedGitHeadEvidencePreparation(
          gitHeadEvidenceSnapshotBeforeCommitAttempt,
        );
    const stderr =
      error instanceof Error && "stderr" in error
        ? String(error.stderr ?? "")
        : "";
    const stdout =
      error instanceof Error && "stdout" in error
        ? String(error.stdout ?? "")
        : "";
    let hookFailureDiagnostic: ReturnType<typeof createHookFailureDiagnosticReport> = null;
    let hookFailureDiagnosticWriteError: string | null = null;
    try {
      hookFailureDiagnostic = createHookFailureDiagnosticReport({
        cwd: options.cwd,
        commitAttemptStatusPath,
        stdout,
        stderr,
      });
    } catch (diagnosticError) {
      hookFailureDiagnosticWriteError = diagnosticError instanceof Error
        ? diagnosticError.message
        : String(diagnosticError);
    }
    const hookFailureSummary = hookFailureDiagnostic?.summary
      ?? summarizeHookFailure({ stdout, stderr });
    writeGitCommitAttemptStatus(options.cwd, commitAttemptStatusPath, {
      schemaId: "atm.gitCommitAttemptStatus.v1",
      actorId,
      taskId: options.taskId,
      sessionId: session?.sessionId ?? null,
      laneSessionId,
      status: headAdvancedDuringAttempt
        ? "committed"
        : isCommitTimeoutFailure
          ? "timeout"
          : "failed",
      phase: headAdvancedDuringAttempt
        ? "commit-observed-after-error"
        : "git-commit-failed",
      startedAt: commitAttemptStartedAt,
      updatedAt: new Date().toISOString(),
      commitSha: headAdvancedDuringAttempt ? headShaAfterFailure : null,
      headShaBeforeCommit,
      headShaAfterAttempt: headShaAfterFailure,
      headAdvancedDuringAttempt,
      timeoutMs: commitTimeoutMs,
      errorCode:
        error instanceof CliError
          ? error.code
          : isCommitTimeoutFailure
            ? "ATM_GIT_COMMIT_TIMEOUT"
            : "UNKNOWN",
      errorSummary: hookFailureSummary
        ?? (error instanceof Error ? error.message.slice(0, 500) : String(error)),
      statusCommand,
      retryCommand,
      copyableCommitCommand: rawCopyableCommitCommand,
      liveIndexResidueRollback,
    });
    if (
      error instanceof CliError &&
      (error.code === "ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY" ||
        error.code === "ATM_GIT_COMMIT_BRANCH_QUEUE_RACE")
    ) {
      throw error;
    }
    if (protectedOverrideAudit?.protectedOverrideAudit?.event?.eventId) {
      protectedOverrideOutcome = recordProtectedOverrideOutcome({
        cwd: options.cwd,
        parentEventId:
          protectedOverrideAudit.protectedOverrideAudit.event.eventId,
        actorId,
        taskId: options.taskId,
        surface: "git commit --no-verify",
        command: commitCommand,
        flags: ["--no-verify"],
        permission: "backend.gitHookBypass",
        leaseId: options.emergencyApproval,
        reason:
          options.overrideReason ??
          "Governed git hook bypass for emergency recovery.",
        skippedChecks: ["pre-commit-hook", "framework-development-gates"],
        touchedFiles: [],
        outcome: "failed",
        failureCode: "ATM_GIT_COMMIT_FAILED",
        emergencyUsePath: protectedOverrideAudit.usePath,
        repairCandidate: buildProtectedOverrideRepairCandidate({
          summary:
            "Git commit failed after an authorized hook bypass; fix the commit error and retry without --no-verify when hooks can pass.",
          suggestedCommand: `node atm.mjs git commit --actor ${actorId}${options.taskId ? ` --task ${options.taskId}` : ""} --message ${quoteCliValue(options.message)} --json`,
          deferredChecks: ["pre-commit-hook", "framework-development-gates"],
        }),
      });
    }
    if (isHeadRaceCommitFailure(stderr)) {
      throw new CliError(
        "ATM_GIT_COMMIT_BRANCH_QUEUE_RACE",
        "Another governed commit advanced HEAD during this commit attempt. Retry through the ATM commit lane after the active writer finishes.",
        {
          exitCode: 1,
          details: {
            actorId,
            taskId: options.taskId,
            sessionId: session?.sessionId ?? null,
            branchRef,
            branchName,
            headShaBeforeCommit,
            headShaAfterFailure,
            headAdvancedDuringAttempt,
            commitAttemptStatusPath,
            statusCommand,
            retryCommand,
            retryable: true,
            requiredCommand: retryCommand,
            stdout,
            stderr,
            gitExecutable: resolveGitExecutable(),
            copyableCommitCommand: rawCopyableCommitCommand,
            hostGitCompatibilityGuidance: buildHostGitCompatibilityGuidance({
              gitExecutable: resolveGitExecutable(),
              stderr,
              stdout,
              copyableCommitCommand: rawCopyableCommitCommand,
            }),
            protectedOverrideOutcome,
            liveIndexResidueRollback,
            gitHeadEvidenceRollback,
          },
        },
      );
    }
    const nestedAttemptStatus = readGitCommitAttemptStatus(
      options.cwd,
      actorId,
      options.taskId ?? null,
    );
    const nestedFailure =
      nestedAttemptStatus && typeof nestedAttemptStatus === "object"
        ? {
            status: nestedAttemptStatus.status ?? null,
            phase: nestedAttemptStatus.phase ?? null,
            errorCode: nestedAttemptStatus.errorCode ?? null,
            errorSummary: nestedAttemptStatus.errorSummary ?? null,
            retryCommand: nestedAttemptStatus.retryCommand ?? null,
            statusCommand: nestedAttemptStatus.statusCommand ?? null,
            copyableCommitCommand:
              nestedAttemptStatus.copyableCommitCommand ?? null,
            liveIndexResidueRollback:
              nestedAttemptStatus.liveIndexResidueRollback ?? null,
          }
        : null;
    throw new CliError(
      "ATM_GIT_COMMIT_FAILED",
      hookFailureSummary ?? "ATM git commit wrapper failed.",
      {
        exitCode: 1,
        details: {
          actorId,
          taskId: options.taskId,
          sessionId: session?.sessionId ?? null,
          stdout,
          stderr,
          hookFailureDiagnostic: hookFailureDiagnostic?.reference ?? null,
          hookFailureDiagnosticWriteError,
          headShaBeforeCommit,
          headShaAfterFailure,
          headAdvancedDuringAttempt,
          commitAttemptStatusPath,
          nestedFailure,
          statusCommand,
          retryCommand,
          recoveryGuidance: headAdvancedDuringAttempt
            ? `HEAD advanced during the failed wrapper attempt. Run ${statusCommand} before retrying; the commit may already have landed as ${headShaAfterFailure}.`
            : nestedFailure?.errorCode
              ? `HEAD did not advance. Resolve nested failure ${nestedFailure.errorCode} from ${commitAttemptStatusPath}, then rerun ${retryCommand}.`
              : `HEAD did not advance. Inspect stdout/stderr and rerun ${retryCommand} after fixing the blocking hook or host git error.`,
          gitExecutable: resolveGitExecutable(),
          copyableCommitCommand: rawCopyableCommitCommand,
          hostGitCompatibilityGuidance: buildHostGitCompatibilityGuidance({
            gitExecutable: resolveGitExecutable(),
            stderr,
            stdout,
            copyableCommitCommand: rawCopyableCommitCommand,
          }),
          protectedOverrideOutcome,
          liveIndexResidueRollback,
          gitHeadEvidenceRollback,
        },
      },
    );
  }

if (protectedOverrideAudit?.protectedOverrideAudit?.event?.eventId) {
    protectedOverrideOutcome = recordProtectedOverrideOutcome({
      cwd: options.cwd,
      parentEventId:
        protectedOverrideAudit.protectedOverrideAudit.event.eventId,
      actorId,
      taskId: options.taskId,
      surface: "git commit --no-verify",
      command: commitCommand,
      flags: ["--no-verify"],
      permission: "backend.gitHookBypass",
      leaseId: options.emergencyApproval,
      reason:
        options.overrideReason ??
        "Governed git hook bypass for emergency recovery.",
      skippedChecks: ["pre-commit-hook", "framework-development-gates"],
      touchedFiles: [],
      outcome: "succeeded",
      emergencyUsePath: protectedOverrideAudit.usePath,
      repairCandidate: buildProtectedOverrideRepairCandidate({
        summary:
          "Hook bypass succeeded; schedule a follow-up commit that passes normal pre-commit governance when recovery is complete.",
        suggestedCommand: "node atm.mjs doctor --json",
        deferredChecks: ["pre-commit-hook", "framework-development-gates"],
      }),
    });
  }

const commitSha = readHeadCommitSha(options.cwd);

const restoredDeferredForeignStagedFiles = cleanupDeferredForeignStagedSnapshot(
    options.cwd,
    deferredForeignStagedSnapshotPath,
  );

writeGitCommitAttemptStatus(options.cwd, commitAttemptStatusPath, {
    schemaId: "atm.gitCommitAttemptStatus.v1",
    actorId,
    taskId: options.taskId,
    sessionId: session?.sessionId ?? null,
    laneSessionId,
    status: "committed",
    phase: "committed",
    startedAt: commitAttemptStartedAt,
    updatedAt: new Date().toISOString(),
    commitSha,
    headShaBeforeCommit,
    headShaAfterAttempt: commitSha,
    headAdvancedDuringAttempt: Boolean(
      commitSha && headShaBeforeCommit && commitSha !== headShaBeforeCommit,
    ),
    timeoutMs: commitTimeoutMs,
    errorCode: null,
    errorSummary: null,
    statusCommand,
    retryCommand,
    copyableCommitCommand: rawCopyableCommitCommand,
    liveIndexResidueRollback: [],
  });

const branchCommitQueue = {
    schemaId: "atm.branchCommitQueueEvidence.v1",
    serializedBy: "branch-commit-queue",
    actorId,
    taskId: options.taskId,
    sessionId: session?.sessionId ?? null,
    branchRef: branchRef ?? "detached-head",
    branchName,
    headShaAtAcquire: headShaBeforeCommit,
    headShaAtCommitStart,
    headShaAfterCommit: commitSha,
    retryableBusyCode: "ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY",
    retryableRaceCode: "ATM_GIT_COMMIT_BRANCH_QUEUE_RACE",
  };

return makeResult({
    ok: true,
    command: "git",
    cwd: options.cwd,
    messages: [
      message(
        "info",
        "ATM_GIT_COMMIT_OK",
        "ATM git commit wrapper created a commit with governed author and trailers.",
        {
          actorId,
          taskId: options.taskId,
          sessionId: session?.sessionId ?? null,
          commitSha,
          branchCommitQueue,
        },
      ),
    ],
    evidence: {
      action: "commit",
      actorId,
      taskId: options.taskId,
      claimLeaseId: claimForTrailers?.leaseId ?? null,
      sessionId: session?.sessionId ?? null,
      laneSessionId,
      commitSha,
      deferredForeignStagedSnapshotPath,
      restoredDeferredForeignStagedFiles,
      branchCommitQueue,
      trailers,
      git: profile,
      gitExecutable: resolveGitExecutable(),
      copyableCommitCommand: buildCopyableGitCommitCommand({
        cwd: options.cwd,
        message: options.message,
        trailers,
        noVerify: options.noVerify,
      }),
      protectedOverrideAudit:
        protectedOverrideAudit?.protectedOverrideAudit ?? null,
      protectedOverrideOutcome,
    },
  });
}

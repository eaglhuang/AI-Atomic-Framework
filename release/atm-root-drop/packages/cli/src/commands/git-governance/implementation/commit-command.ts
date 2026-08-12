import { resolveCommitLaneSessionId } from './command-router.ts';
import { resolveTaskScopedCommitBundle } from './commit-bundle-resolution.ts';
import { captureGitHeadEvidencePreparation } from './git-head-evidence-transaction.ts';
import { actorIdEnvVar, actorRegistryRelativePath, findActorByResolvedId, inspectTrackedActorRegistryState, readRuntimeIdentityDefault, readRuntimeIdentityForActor, resolveActorId, writeRuntimeIdentityForActor } from "../../actor-registry.ts";
import {
  classifyBlockLifecycleRecordBundle,
  recordOnlyClaimScopeExemptCovers,
  RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV,
  RECORD_COMMIT_BLOCK_BRIDGE_AUTH_DIR,
  RECORD_COMMIT_BLOCK_BRIDGE_DEFAULT_TTL_MS,
} from "../record-only-block-lifecycle-bridge.ts";
import { recordProtectedOverrideOutcome } from "../../emergency/gate.ts";
import {
  extractGovernanceTaskIdFromPath,
  inspectTouchedPhysicalLineBudget,
  isProtectedStagedGovernanceOwnershipPath,
  normalizeRelativePath,
  normalizeTaskClaimIntent,
  pathMatchesTaskScope,
  uniqueSorted,
} from "../commit-scope-policy.ts";
import { CliError, makeResult, message, quoteCliValue, relativePathFrom } from "../../shared.ts";
import { prepareHookBypassRequest } from './broker-hook-bypass-preflight.ts';
import { buildCopyableGitCommitCommand, buildHostGitCompatibilityGuidance, cleanupDeferredForeignStagedSnapshot, inspectCloseCommitWindowStagedArtifacts, readStagedFiles, recordGitIndexRestoreFailure, rollbackNewlyStagedLiveIndexResidue, withTaskScopedCommitIndex } from './git-index-transaction.ts';
import { assertNoStdinPathspecGitAddPreflight, createSanitizedGitEnv, gitCommitAttemptStatusRelativePath, readGitCommitAttemptStatus, resolveGitCommitTimeoutMs, shouldStageGovernedGitHeadEvidenceBeforeCommit, stageTrackedActorRegistryIfNeeded, writeGitCommitAttemptStatus } from './git-process-port.ts';
import { buildIdentitySetRequiredCommand, parseTaskClaim, readTaskDocument, requireExplicitGitActor, resolveGitGovernanceSession, resolveGitIdentityProfile } from './identity-check-command.ts';
import { isHeadRaceCommitFailure, readHeadBranchRef, readHeadCommitSha } from './push-command.ts';
import { inspectHistoricalLedgerRestoreStagedArtifacts, inspectMirrorSyncOnlyStagedArtifacts } from './record-bundle-inspection.ts';
import { autoStageFrameworkClaimFiles, inspectFrameworkScopedUnstagedCommit, inspectTaskScopedStagedGovernanceBundle, inspectTaskScopedUnstagedCommit, isFrameworkGeneratedArtifactAllowed, isIgnorableFrameworkCommitStagingSideEffect, readActiveFrameworkClaimFiles, readReleaseGeneratedArtifactPaths } from './task-scope-staging.ts';
import { resolveFrameworkHookTaskId } from './framework-hook-identity.ts';
import { executeGitCommit } from './commit-execution.ts';
import { resolveFrameworkCommitAuthorityContext } from '../../framework-development/framework-temp-publication-capability.ts';
import { assertFrameworkCommitClaimAuthority } from './framework-commit-claim-guard.ts';
type LegacyValue = ReturnType<typeof JSON.parse>;
export function runGitCommit(options: LegacyValue) {
  const resolvedActor = resolveActorId(
    options.actorId ?? undefined,
    options.cwd,
  );

if (!resolvedActor) {
    throw new CliError(
      "ATM_ACTOR_ID_MISSING",
      `git commit requires --actor or ${actorIdEnvVar} (legacy alias: AGENT_IDENTITY).`,
      { exitCode: 2 },
    );
  }
requireExplicitGitActor(resolvedActor, "git commit");

if (!options.message) {
    throw new CliError(
      "ATM_CLI_USAGE",
      "git commit requires --message <summary>.",
      { exitCode: 2 },
    );
  }

const actorId = resolvedActor.actorId;

if (options.wip) {
    process.env.ATM_COMMIT_WIP = "1";
  }

assertNoStdinPathspecGitAddPreflight(options.cwd);

const commitCommand = `node atm.mjs git commit --actor ${actorId}${options.taskId ? ` --task ${options.taskId}` : ""} --message ${quoteCliValue(options.message)}${options.noVerify ? " --no-verify" : ""} --json`;

let protectedOverrideAudit = null;

const actorRecord = findActorByResolvedId(options.cwd, resolvedActor);

const profile = resolveGitIdentityProfile(options.cwd, actorId, actorRecord, {
    explicitGitName: options.gitName,
    explicitGitEmail: options.gitEmail,
  });

if (!profile.gitName || !profile.gitEmail) {
    throw new CliError(
      "ATM_GIT_COMMIT_IDENTITY_MISSING",
      "git commit requires a resolved git identity profile. Run identity set or actor register first.",
      {
        exitCode: 2,
        details: {
          actorId,
          requiredCommand: buildIdentitySetRequiredCommand(
            options.cwd,
            actorId,
          ),
        },
      },
    );
  }

const gitName = profile.gitName;

const gitEmail = profile.gitEmail;

const taskDocument = options.taskId
    ? readTaskDocument(options.cwd, options.taskId)
    : null;

const { usesFrameworkClaimCommit, frameworkClaimRequired, frameworkClaimFiles, frameworkClaimTaskId } = resolveFrameworkCommitAuthorityContext({
  cwd: options.cwd, taskId: options.taskId, actorId, taskExists: taskDocument !== null,
});

assertFrameworkCommitClaimAuthority({ actorId, laneSessionId: process.env.ATM_LANE_SESSION_ID ?? null, authority: { usesFrameworkClaimCommit, frameworkClaimRequired, frameworkClaimFiles, frameworkClaimTaskId } });

const claim = taskDocument ? parseTaskClaim(taskDocument.claim) : null;

const stagedMirrorSync = options.taskId
    ? inspectMirrorSyncOnlyStagedArtifacts(options.cwd, options.taskId)
    : null;

const stagedHistoricalRestore = options.taskId
    ? inspectHistoricalLedgerRestoreStagedArtifacts(options.cwd, options.taskId)
    : null;

const stagedCloseCommitWindow = options.taskId
    ? inspectCloseCommitWindowStagedArtifacts(options.cwd, options.taskId)
    : null;

const bypassesActiveSession =
    stagedMirrorSync?.ok ||
    stagedHistoricalRestore?.ok ||
    stagedCloseCommitWindow?.ok ||
    Boolean(options.wip);

const claimForTrailers = bypassesActiveSession ? null : claim;

const session = resolveGitGovernanceSession(options.cwd, {
    sessionId: options.sessionId ?? null,
    actorId,
    taskId: options.taskId,
    claimLeaseId: claimForTrailers?.leaseId ?? null,
    allowImplicitSession: Boolean(options.taskId && !bypassesActiveSession),
  });

const laneSessionId = resolveCommitLaneSessionId({
    claim: claimForTrailers,
    session,
  });

let deferredForeignStagedSnapshotPath = null;

let taskScopedBundleReport = null;
const liveIndexSnapshotBeforeCommitAttempt = readStagedFiles(options.cwd);

if (options.taskId && !session && !bypassesActiveSession) {
    throw new CliError(
      "ATM_GIT_COMMIT_SESSION_REQUIRED",
      `git commit requires an active or recent ATM work session for ${options.taskId}.`,
      {
        exitCode: 1,
        details: {
          actorId,
          taskId: options.taskId,
          requiredCommand: `node atm.mjs next --claim --actor ${actorId} --prompt "${options.taskId}" --json`,
        },
      },
    );
  }

if (options.taskId && taskDocument && !bypassesActiveSession) {
    const bundleReport = resolveTaskScopedCommitBundle({
      cwd: options.cwd,
      taskId: options.taskId,
      taskDocument,
      apply:
        !options.dryRun && (options.autoStage || options.deferForeignStaged),
      autoStage: options.autoStage,
      deferForeignStaged: options.deferForeignStaged,
      stageOverrideLease: options.stageOverrideLease,
      brokerConflictResolutionPath: options.brokerConflictResolutionPath,
      message: options.message,
      actorId,
      trailers: [
        `ATM-Actor: ${actorId}`,
        `ATM-Task: ${options.taskId}`,
        ...(options.wip
          ? [
              "ATM-WIP: true",
              "ATM-Delivery: false",
              "ATM-Closeout-Eligible: false",
              ...(options.overrideReason
                ? [`ATM-Reason: ${options.overrideReason}`]
                : []),
            ]
          : []),
        ...(claimForTrailers?.leaseId
          ? [`ATM-Claim: ${claimForTrailers.leaseId}`]
          : []),
        ...(session?.sessionId ? [`ATM-Session: ${session.sessionId}`] : []),
        ...(laneSessionId ? [`ATM-Lane-Session: ${laneSessionId}`] : []),
      ],
    });
    taskScopedBundleReport = bundleReport;
    deferredForeignStagedSnapshotPath =
      bundleReport.deferredForeignStagedSnapshot;
    const copyableCommitCommand = bundleReport.copyableCommitCommand;
    if (options.dryRun) {
      return makeResult({
        ok: bundleReport.ok,
        command: "git",
        cwd: options.cwd,
        messages: [
          bundleReport.ok
            ? message(
                "info",
                "ATM_GIT_COMMIT_BUNDLE_DRY_RUN",
                `git commit dry-run for ${options.taskId} resolved a task-scoped bundle without mutating the index.`,
                {
                  taskId: options.taskId,
                  stageFiles: bundleReport.stageFiles,
                  skippedExternalDirtyFiles:
                    bundleReport.skippedExternalDirtyFiles,
                },
              )
            : message(
                "error",
                bundleReport.blockedCode ?? "ATM_GIT_COMMIT_BUNDLE_BLOCKED",
                bundleReport.blockedSummary ??
                  "Task-scoped commit bundle resolver blocked the commit.",
                { commitBundle: bundleReport },
              ),
        ],
        evidence: {
          action: "commit",
          dryRun: true,
          actorId,
          taskId: options.taskId,
          sessionId: session?.sessionId ?? null,
          commitBundle: bundleReport,
          laneSessionId,
          copyableCommitCommand,
        },
      });
    }
    if (!bundleReport.ok) {
      cleanupDeferredForeignStagedSnapshot(
        options.cwd,
        deferredForeignStagedSnapshotPath,
      );
      throw new CliError(
        bundleReport.blockedCode ?? "ATM_GIT_COMMIT_BUNDLE_BLOCKED",
        bundleReport.blockedSummary ??
          "Task-scoped commit bundle resolver blocked the commit.",
        {
          exitCode: 1,
          details: {
            actorId,
            taskId: options.taskId,
            sessionId: session?.sessionId ?? null,
            commitBundle: bundleReport,
            copyableCommitCommand,
            unexpectedStagedTasks: bundleReport.unexpectedStagedTasks,
            skippedExternalDirtyFiles: bundleReport.skippedExternalDirtyFiles,
            requiredCommand:
              bundleReport.blockedCode ===
              "ATM_GIT_COMMIT_CLOSEOUT_ONLY_MUTATION"
                ? `node atm.mjs next --claim --actor ${quoteCliValue(actorId)} --task ${quoteCliValue(options.taskId)} --claim-intent write --json`
                : null,
          },
        },
      );
    }
    // `--auto-stage` assembles and verifies the bundle in a sealed candidate
    // index. Re-staging it in the shared index is redundant and lets foreign
    // lanes contend on bytes this commit will never consume.
    const stagedBundleInspection = options.autoStage
      ? { ok: true, code: '', summary: '', warnings: [], details: {} }
      : inspectTaskScopedStagedGovernanceBundle(
        options.cwd,
        options.taskId,
        taskDocument,
      );
    if (!stagedBundleInspection.ok) {
      cleanupDeferredForeignStagedSnapshot(
        options.cwd,
        deferredForeignStagedSnapshotPath,
      );
      throw new CliError(
        stagedBundleInspection.code,
        stagedBundleInspection.summary,
        {
          exitCode: 1,
          details: {
            actorId,
            taskId: options.taskId,
            sessionId: session?.sessionId ?? null,
            ...stagedBundleInspection.details,
            copyableCommitCommand,
            governanceBundleWarnings: stagedBundleInspection.warnings,
          },
        },
      );
    }
    const stagingInspection = options.autoStage
      ? null
      : inspectTaskScopedUnstagedCommit(
        options.cwd,
        options.taskId,
        taskDocument,
      );
    if (stagingInspection?.kind === "staging-required") {
      cleanupDeferredForeignStagedSnapshot(
        options.cwd,
        deferredForeignStagedSnapshotPath,
      );
      throw new CliError(
        "ATM_GIT_COMMIT_TASK_SCOPED_STAGING_REQUIRED",
        `git commit for ${options.taskId} requires staged task-scoped files before the wrapper can create a governed commit.`,
        {
          exitCode: 1,
          details: {
            actorId,
            taskId: options.taskId,
            sessionId: session?.sessionId ?? null,
            inScopeDirtyFiles: stagingInspection.inScopeDirtyFiles,
            skippedExternalDirtyFiles:
              stagingInspection.skippedExternalDirtyFiles,
            requiredCommand: stagingInspection.requiredCommand,
            autoStageCommand: `node atm.mjs git commit --actor ${quoteCliValue(actorId)} --task ${quoteCliValue(options.taskId)} --message ${quoteCliValue(options.message)} --auto-stage --json`,
            copyableCommitCommand,
          },
        },
      );
    }
    if (stagingInspection?.kind === "mixed-scope") {
      cleanupDeferredForeignStagedSnapshot(
        options.cwd,
        deferredForeignStagedSnapshotPath,
      );
      throw new CliError(
        "ATM_GIT_COMMIT_TASK_SCOPED_STAGING_AMBIGUOUS",
        `git commit for ${options.taskId} found out-of-scope files already staged with task-scoped work; defer foreign staged files or stage only in-scope files manually before retrying.`,
        {
          exitCode: 1,
          details: {
            actorId,
            taskId: options.taskId,
            sessionId: session?.sessionId ?? null,
            inScopeDirtyFiles: stagingInspection.inScopeDirtyFiles,
            outOfScopeStagedFiles: stagingInspection.outOfScopeStagedFiles,
            deferForeignStagedCommand: `node atm.mjs git commit --actor ${quoteCliValue(actorId)} --task ${quoteCliValue(options.taskId)} --message ${quoteCliValue(options.message)} --defer-foreign-staged --json`,
            copyableCommitCommand,
          },
        },
      );
    }
  }

const autoStagedFrameworkPaths =
    usesFrameworkClaimCommit && options.autoStage
      ? autoStageFrameworkClaimFiles(options.cwd, actorId, !options.dryRun, frameworkClaimFiles)
      : [];

let frameworkClaimCommitFiles: readonly string[] = [];

if (usesFrameworkClaimCommit) {
    const frameworkStagingInspection = inspectFrameworkScopedUnstagedCommit(
      options.cwd,
      actorId,
      frameworkClaimFiles,
    );
    if (options.dryRun && options.autoStage) {
      if (
        frameworkStagingInspection?.kind === "mixed-scope" &&
        !options.deferForeignStaged &&
        !recordOnlyClaimScopeExemptCovers(
          options.recordOnlyClaimScopeExemptPaths ?? [],
          frameworkStagingInspection.outOfScopeStagedFiles ?? [],
        )
      ) {
        throw new CliError(
          "ATM_GIT_COMMIT_FRAMEWORK_STAGING_AMBIGUOUS",
          "git commit found staged out-of-claim files on a framework claim; pass --defer-foreign-staged to commit only the claim scope while leaving foreign staged files untouched, or stage only the claim scope before retrying.",
          {
            exitCode: 1,
            details: {
              actorId,
              inScopeDirtyFiles: frameworkStagingInspection.inScopeDirtyFiles,
              outOfScopeStagedFiles:
                frameworkStagingInspection.outOfScopeStagedFiles,
              requiredCommand: `node atm.mjs git commit --actor ${quoteCliValue(actorId)} --message ${quoteCliValue(options.message)} --auto-stage --defer-foreign-staged --json`,
            },
          },
        );
      }
      return makeResult({
        ok: true,
        command: "git",
        cwd: options.cwd,
        messages: [
          message(
            "info",
            "ATM_GIT_COMMIT_FRAMEWORK_DRY_RUN",
            "git commit dry-run for the active framework claim resolved the governed commit surface without mutating the index.",
            {
              actorId,
              frameworkClaimFiles: frameworkClaimFiles ?? readActiveFrameworkClaimFiles(options.cwd, actorId),
              autoStageCandidates: autoStagedFrameworkPaths,
              outOfScopeStagedFiles:
                frameworkStagingInspection?.kind === "mixed-scope"
                  ? frameworkStagingInspection.outOfScopeStagedFiles
                  : [],
            },
          ),
        ],
        evidence: {
          action: "commit",
          dryRun: true,
          actorId,
          taskId: options.taskId,
          frameworkClaimFiles: frameworkClaimFiles ?? readActiveFrameworkClaimFiles(options.cwd, actorId),
          autoStageCandidates: autoStagedFrameworkPaths,
          stagedFiles: readStagedFiles(options.cwd),
          copyableCommitCommand: buildCopyableGitCommitCommand({
            cwd: options.cwd,
            message: options.message,
            trailers: [`ATM-Actor: ${actorId}`],
          }),
        },
      });
    }
    if (frameworkStagingInspection?.kind === "staging-required") {
      throw new CliError(
        "ATM_GIT_COMMIT_FRAMEWORK_STAGING_REQUIRED",
        "git commit found unstaged framework-claim changes; stage the claimed files (and derived release artifacts) before the wrapper can create a governed commit.",
        {
          exitCode: 1,
          details: {
            actorId,
            inScopeDirtyFiles: frameworkStagingInspection.inScopeDirtyFiles,
            skippedExternalDirtyFiles:
              frameworkStagingInspection.skippedExternalDirtyFiles,
            requiredCommand: frameworkStagingInspection.requiredCommand,
            autoStageCommand: `node atm.mjs git commit --actor ${quoteCliValue(actorId)} --message ${quoteCliValue(options.message)} --auto-stage --json`,
          },
        },
      );
    }
    if (
      frameworkStagingInspection?.kind === "mixed-scope" &&
      !options.deferForeignStaged &&
      !recordOnlyClaimScopeExemptCovers(
        options.recordOnlyClaimScopeExemptPaths ?? [],
        frameworkStagingInspection.outOfScopeStagedFiles ?? [],
      )
    ) {
      throw new CliError(
        "ATM_GIT_COMMIT_FRAMEWORK_STAGING_AMBIGUOUS",
        "git commit found staged out-of-claim files on a framework claim; pass --defer-foreign-staged to commit only the claim scope while leaving foreign staged files untouched, or stage only the claim scope before retrying.",
        {
          exitCode: 1,
          details: {
            actorId,
            inScopeDirtyFiles: frameworkStagingInspection.inScopeDirtyFiles,
            outOfScopeStagedFiles:
              frameworkStagingInspection.outOfScopeStagedFiles,
            requiredCommand: `node atm.mjs git commit --actor ${quoteCliValue(actorId)} --message ${quoteCliValue(options.message)} --auto-stage --defer-foreign-staged --json`,
          },
        },
      );
    }
    const claimedFiles = new Set(
      frameworkClaimFiles ?? readActiveFrameworkClaimFiles(options.cwd, actorId),
    );
    if (claimedFiles.size > 0) {
      const releaseGeneratedArtifacts = readReleaseGeneratedArtifactPaths(
        options.cwd,
      );
      frameworkClaimCommitFiles = uniqueSorted(
        readStagedFiles(options.cwd).filter(
          (filePath: LegacyValue) =>
            (!options.deferForeignStaged && isIgnorableFrameworkCommitStagingSideEffect(filePath)) ||
            isFrameworkGeneratedArtifactAllowed(
              filePath,
              claimedFiles,
              releaseGeneratedArtifacts,
            ),
        ),
      );
    }
  }

const hookTaskId = resolveFrameworkHookTaskId({
  taskId: options.taskId,
  frameworkClaimTaskId,
  frameworkClaimCommitFiles,
});

const trailers = [
    `ATM-Actor: ${actorId}`,
    ...(options.taskId ? [`ATM-Task: ${options.taskId}`] : []),
    ...(options.wip
      ? [
          "ATM-WIP: true",
          "ATM-Delivery: false",
          "ATM-Closeout-Eligible: false",
          ...(options.overrideReason
            ? [`ATM-Reason: ${options.overrideReason}`]
            : []),
        ]
      : []),
    ...(claimForTrailers?.leaseId
      ? [`ATM-Claim: ${claimForTrailers.leaseId}`]
      : []),
    ...(session?.sessionId ? [`ATM-Session: ${session.sessionId}`] : []),
    ...(laneSessionId ? [`ATM-Lane-Session: ${laneSessionId}`] : []),
    ...options.extraTrailers,
  ];

const retryCommand = `node atm.mjs git commit --actor ${quoteCliValue(actorId)}${options.taskId ? ` --task ${quoteCliValue(options.taskId)}` : ""} --message ${quoteCliValue(options.message)}${options.autoStage ? " --auto-stage" : ""}${options.noVerify ? " --no-verify" : ""} --json`;

const statusCommand = `node atm.mjs git commit-status --actor ${quoteCliValue(actorId)}${options.taskId ? ` --task ${quoteCliValue(options.taskId)}` : ""} --json`;

const rawCopyableCommitCommand = buildCopyableGitCommitCommand({
    cwd: options.cwd,
    message: options.message,
    trailers,
    noVerify: options.noVerify,
  });

const args = [
    "commit",
    ...(options.noVerify ? ["--no-verify"] : []),
    "--message",
    options.message,
    "--message",
    trailers.join("\n"),
];

// All rejectable checks use the sealed task candidate before consuming a
// one-time bypass lease.  The shared index is deliberately not an input here:
// its foreign residue is neither part of this commit nor authority to block it.
const candidateFiles = taskScopedBundleReport?.commitFiles ?? frameworkClaimCommitFiles;
const hookBypassRequest = options.noVerify
  ? prepareHookBypassRequest({
    cwd: options.cwd, taskId: options.taskId, actorId,
    deferForeignStaged: options.deferForeignStaged, candidateFiles,
    brokerConflictOverrideApproval: options.brokerConflictOverrideApproval,
    brokerConflictResolutionPath: options.brokerConflictResolutionPath,
    reason: options.overrideReason, command: commitCommand,
    emergencyApproval: options.emergencyApproval,
  })
  : null;

let protectedOverrideOutcome = null;

const branchRef = readHeadBranchRef(options.cwd);

const branchName = branchRef
    ? branchRef.replace(/^refs\/heads\//, "")
    : "detached-head";

const headShaBeforeCommit = readHeadCommitSha(options.cwd);

let headShaAtCommitStart = headShaBeforeCommit;

const gitHeadEvidenceSnapshotBeforeCommitAttempt =
    captureGitHeadEvidencePreparation(options.cwd);

const commitTimeoutMs = resolveGitCommitTimeoutMs(options.timeoutMs);

const commitAttemptStatusPath = gitCommitAttemptStatusRelativePath(
    actorId,
    options.taskId,
  );

const commitAttemptStartedAt = new Date().toISOString();

writeGitCommitAttemptStatus(options.cwd, commitAttemptStatusPath, {
    schemaId: "atm.gitCommitAttemptStatus.v1",
    actorId,
    taskId: options.taskId,
    sessionId: session?.sessionId ?? null,
    laneSessionId,
    status: "in-progress",
    phase: "preparing-commit",
    startedAt: commitAttemptStartedAt,
    updatedAt: commitAttemptStartedAt,
    commitSha: null,
    headShaBeforeCommit,
    headShaAfterAttempt: null,
    headAdvancedDuringAttempt: null,
    timeoutMs: commitTimeoutMs,
    errorCode: null,
    errorSummary: null,
    statusCommand,
    retryCommand,
    copyableCommitCommand: rawCopyableCommitCommand,
    liveIndexResidueRollback: [],
  });
return executeGitCommit(options, { actorId, args, autoStagedFrameworkPaths, branchName, branchRef, bypassesActiveSession, claimForTrailers, commitAttemptStartedAt, commitAttemptStatusPath, commitCommand, commitTimeoutMs, deferredForeignStagedSnapshotPath, frameworkClaimCommitFiles, gitEmail, gitHeadEvidenceSnapshotBeforeCommitAttempt, gitName, headShaAtCommitStart, headShaBeforeCommit, hookBypassRequest, hookTaskId, laneSessionId, liveIndexSnapshotBeforeCommitAttempt, profile, protectedOverrideAudit, protectedOverrideOutcome, rawCopyableCommitCommand, retryCommand, session, statusCommand, taskDocument, taskScopedBundleReport, trailers });
}

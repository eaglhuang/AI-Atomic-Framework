import { resolveCommitLaneSessionId } from './command-router.ts';
import { resolveTaskScopedCommitBundle } from './commit-bundle-resolution.ts';
import { captureGitHeadEvidencePreparation } from './git-head-evidence-transaction.ts';
import { readWorkAdmissionTicket } from '../work-admission-check.ts';
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
import { assertDryRunReachedNoExecutor, resolveDryRunPurity } from './dry-run-purity.ts';
import { routeFrameworkClaimCommitBranch } from './commit-framework-branch.ts';
import { routeTaskScopedCommitBranch } from './commit-task-scoped-branch.ts';
type LegacyValue = ReturnType<typeof JSON.parse>;

export function permitsTerminalRepairClosureSessionBypass(ticket: { readonly origin?: unknown } | null): boolean {
  return ticket?.origin === 'repair-closure';
}

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

const dryRunPurity = resolveDryRunPurity(options); // ATM-GOV-0394: before branch selection.
const taskDocument = options.taskId
    ? readTaskDocument(options.cwd, options.taskId)
    : null;

const { usesFrameworkClaimCommit, frameworkClaimRequired, frameworkClaimFiles, frameworkClaimTaskId, frameworkClaimResolution } = resolveFrameworkCommitAuthorityContext({
  cwd: options.cwd, taskId: options.taskId, actorId, taskExists: taskDocument !== null,
});

assertFrameworkCommitClaimAuthority({ actorId, laneSessionId: process.env.ATM_LANE_SESSION_ID ?? null, authority: { usesFrameworkClaimCommit, frameworkClaimRequired, frameworkClaimFiles, frameworkClaimTaskId, frameworkClaimResolution } });

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

const terminalRepairTicket = options.taskId
  ? readWorkAdmissionTicket(options.cwd, options.taskId)
  : null;

const bypassesActiveSession =
    stagedMirrorSync?.ok ||
    stagedHistoricalRestore?.ok ||
    stagedCloseCommitWindow?.ok ||
    permitsTerminalRepairClosureSessionBypass(terminalRepairTicket) ||
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
  const taskBranch = routeTaskScopedCommitBranch({ options, actorId, taskDocument, claim, claimForTrailers, session, laneSessionId });
  if (taskBranch.kind === "preview") return taskBranch.result;
  taskScopedBundleReport = taskBranch.taskScopedBundleReport;
  deferredForeignStagedSnapshotPath = taskBranch.deferredForeignStagedSnapshotPath;
}

const frameworkBranch = routeFrameworkClaimCommitBranch({ options, actorId, usesFrameworkClaimCommit, frameworkClaimFiles });
if (frameworkBranch.kind === "preview") return frameworkBranch.result;
const { autoStagedFrameworkPaths, frameworkClaimCommitFiles } = frameworkBranch;

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
assertDryRunReachedNoExecutor(dryRunPurity, { taskId: options.taskId ?? null, usesFrameworkClaimCommit });
return executeGitCommit(options, { actorId, args, autoStagedFrameworkPaths, branchName, branchRef, bypassesActiveSession, claimForTrailers, commitAttemptStartedAt, commitAttemptStatusPath, commitCommand, commitTimeoutMs, deferredForeignStagedSnapshotPath, frameworkClaimCommitFiles, gitEmail, gitHeadEvidenceSnapshotBeforeCommitAttempt, gitName, headShaAtCommitStart, headShaBeforeCommit, hookBypassRequest, hookTaskId, laneSessionId, liveIndexSnapshotBeforeCommitAttempt, profile, protectedOverrideAudit, protectedOverrideOutcome, rawCopyableCommitCommand, retryCommand, session, statusCommand, taskDocument, taskScopedBundleReport, trailers });
}

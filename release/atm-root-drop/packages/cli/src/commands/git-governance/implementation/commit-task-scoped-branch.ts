/**
 * git-governance/implementation/commit-task-scoped-branch.ts
 *
 * ATM-GOV-0394 — the task-scoped lifecycle branch of a governed commit.
 *
 * Extracted from commit-command.ts alongside the framework branch, so the
 * command file routes between named branches instead of containing them. This
 * branch owns one decision: given a live task claim, which files does the
 * task's scope authorize this commit to carry, and is this request a preview.
 *
 * It never executes a commit. It returns either a preview result, or the
 * resolved bundle plus any deferred foreign-staged snapshot for the caller.
 */
import { resolveTaskScopedCommitBundle } from './commit-bundle-resolution.ts';
import { classifyBlockLifecycleRecordBundle, recordOnlyClaimScopeExemptCovers, RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV, RECORD_COMMIT_BLOCK_BRIDGE_AUTH_DIR, RECORD_COMMIT_BLOCK_BRIDGE_DEFAULT_TTL_MS } from '../record-only-block-lifecycle-bridge.ts';
import { extractGovernanceTaskIdFromPath, inspectTouchedPhysicalLineBudget, isProtectedStagedGovernanceOwnershipPath, normalizeRelativePath, normalizeTaskClaimIntent, pathMatchesTaskScope, uniqueSorted } from '../commit-scope-policy.ts';
import { CliError, makeResult, message, quoteCliValue, relativePathFrom } from '../../shared.ts';
import { buildCopyableGitCommitCommand, cleanupDeferredForeignStagedSnapshot, readStagedFiles } from './git-index-transaction.ts';
import { inspectTaskScopedStagedGovernanceBundle, inspectTaskScopedUnstagedCommit } from './task-scope-staging.ts';

type LegacyValue = ReturnType<typeof JSON.parse>;

export type TaskScopedBranchOutcome =
  | { readonly kind: 'preview'; readonly result: ReturnType<typeof makeResult> }
  | {
      readonly kind: 'resolved';
      readonly taskScopedBundleReport: LegacyValue;
      readonly deferredForeignStagedSnapshotPath: LegacyValue;
    };

export function routeTaskScopedCommitBranch(input: {
  readonly options: LegacyValue;
  readonly actorId: string;
  readonly taskDocument: LegacyValue;
  readonly claim: LegacyValue;
  readonly session: LegacyValue;
  readonly claimForTrailers: LegacyValue;
  readonly laneSessionId: string | null;
}): TaskScopedBranchOutcome {
  const { options, actorId, taskDocument, claim, claimForTrailers, session, laneSessionId } = input;
  let taskScopedBundleReport: LegacyValue = null;
  let deferredForeignStagedSnapshotPath: LegacyValue = null;
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
      deliverySliceManifestPath: options.deliverySliceManifestPath,
      deliverySliceReceiptPath: options.deliverySliceReceiptPath,
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
      return { kind: "preview", result: makeResult({
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
      }) };
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
  return { kind: "resolved", taskScopedBundleReport, deferredForeignStagedSnapshotPath };
}

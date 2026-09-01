/**
 * git-governance/implementation/commit-framework-branch.ts
 *
 * ATM-GOV-0394 — the framework-claim lifecycle branch of a governed commit.
 *
 * Extracted from commit-command.ts so that file becomes a router over named
 * lifecycle branches rather than one procedure containing them. The branch owns
 * exactly one decision: given a live framework claim, which files may this
 * commit carry, and is this request a preview rather than a commit.
 *
 * It never executes a commit. It either returns a preview result for the
 * caller to hand back, or reports the staged surface for the caller to carry
 * forward.
 */
import { recordOnlyClaimScopeExemptCovers } from '../record-only-block-lifecycle-bridge.ts';
import { uniqueSorted } from '../commit-scope-policy.ts';
import { CliError, makeResult, message, quoteCliValue } from '../../shared.ts';
import { buildCopyableGitCommitCommand, readStagedFiles } from './git-index-transaction.ts';
import { autoStageFrameworkClaimFiles, frameworkTempTaskId, inspectFrameworkScopedUnstagedCommit, isFrameworkGeneratedArtifactAllowed, isIgnorableFrameworkCommitStagingSideEffect, readActiveFrameworkClaimFiles, readReleaseGeneratedArtifactPaths } from './task-scope-staging.ts';

type LegacyValue = ReturnType<typeof JSON.parse>;

export type FrameworkBranchOutcome =
  | { readonly kind: 'preview'; readonly result: ReturnType<typeof makeResult> }
  | {
      readonly kind: 'staged';
      readonly autoStagedFrameworkPaths: readonly string[];
      readonly frameworkClaimCommitFiles: readonly string[];
    };

export function routeFrameworkClaimCommitBranch(input: {
  readonly options: LegacyValue;
  readonly actorId: string;
  readonly usesFrameworkClaimCommit: boolean;
  readonly frameworkClaimFiles: readonly string[] | null;
}): FrameworkBranchOutcome {
  const { options, actorId, usesFrameworkClaimCommit, frameworkClaimFiles } = input;
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
      return { kind: "preview", result: makeResult({
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
      }) };
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
      const ownerScope = { cwd: options.cwd, currentTaskId: frameworkTempTaskId(actorId) };
      frameworkClaimCommitFiles = uniqueSorted(
        readStagedFiles(options.cwd).filter(
          (filePath: LegacyValue) =>
            (!options.deferForeignStaged && isIgnorableFrameworkCommitStagingSideEffect(filePath)) ||
            isFrameworkGeneratedArtifactAllowed(
              filePath,
              claimedFiles,
              releaseGeneratedArtifacts,
              ownerScope,
            ),
        ),
      );
    }
  }
  return { kind: "staged", autoStagedFrameworkPaths, frameworkClaimCommitFiles };
}

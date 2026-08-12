import { resolveTaskBoundCommitFiles } from './commit-bundle-selection.ts';
import { resolveTaskScopedCommitBundle } from './commit-bundle-resolution.ts';
import { ensureGovernedGitHeadEvidenceStagedForCommit } from './git-head-evidence-transaction.ts';
import {
  shouldStageGovernedGitHeadEvidenceBeforeCommit,
  stageTrackedActorRegistryIfNeeded,
} from './git-process-port.ts';
import { readStagedFiles } from './git-index-transaction.ts';
import { inspectTouchedPhysicalLineBudget } from '../commit-scope-policy.ts';
import { CliError } from '../../shared.ts';

type LegacyValue = ReturnType<typeof JSON.parse>;

export interface CommitCandidatePreparation {
  readonly scopedCommitFiles: LegacyValue;
  readonly stagedCommitSurface: LegacyValue;
  readonly preStagedEvidence: LegacyValue;
}

export function prepareCommitCandidate(input: LegacyValue): CommitCandidatePreparation {
  const resolvedTaskBundle =
    input.options.taskId !== null && input.taskDocument
      ? (input.taskScopedBundleReport ??
          resolveTaskScopedCommitBundle({
            cwd: input.options.cwd,
            taskId: input.options.taskId,
            taskDocument: input.taskDocument,
            apply: false,
            autoStage: input.options.autoStage,
            deferForeignStaged: input.options.deferForeignStaged,
            stageOverrideLease: input.options.stageOverrideLease,
            brokerConflictResolutionPath: input.options.brokerConflictResolutionPath,
            message: input.options.message,
            actorId: input.actorId,
            trailers: input.trailers,
          }))
      : null;
  const bundleFiles = resolveTaskBoundCommitFiles({
    taskId: input.options.taskId,
    taskDocument: input.taskDocument,
    taskScopedBundleReport: resolvedTaskBundle,
    frameworkClaimCommitFiles: input.frameworkClaimCommitFiles,
  });
  const autoStagedActorRegistryPath =
    input.options.taskId === null
      ? stageTrackedActorRegistryIfNeeded(input.options.cwd)
      : null;
  const scopedCommitFiles =
    bundleFiles.length > 0 ? bundleFiles : input.frameworkClaimCommitFiles;
  const preStagedEvidence =
    !input.options.noVerify && scopedCommitFiles.length === 0
      ? ensureGovernedGitHeadEvidenceStagedForCommit(input.options.cwd, input.actorId)
      : null;
  const stagedCommitSurface =
    scopedCommitFiles.length > 0 ? scopedCommitFiles : readStagedFiles(input.options.cwd);
  assertGovernedCommitPhysicalLineBudget(
    input.options.cwd,
    stagedCommitSurface,
    input.actorId,
    input.hookTaskId,
  );
  if (
    !input.options.noVerify &&
    scopedCommitFiles.length === 0 &&
    shouldStageGovernedGitHeadEvidenceBeforeCommit(stagedCommitSurface) &&
    !preStagedEvidence
  ) {
    throw new CliError(
      'ATM_GIT_COMMIT_GIT_HEAD_PREPARE_FAILED',
      'ATM could not pre-stage git-head evidence for this governed commit.',
      {
        exitCode: 1,
        details: {
          actorId: input.actorId,
          taskId: input.options.taskId,
          stagedCommitSurface,
          autoStagedActorRegistryPath,
          autoStagedFrameworkPaths: input.autoStagedFrameworkPaths,
        },
      },
    );
  }
  return { scopedCommitFiles, stagedCommitSurface, preStagedEvidence };
}

export function assertGovernedCommitPhysicalLineBudget(
  cwd: LegacyValue,
  files: LegacyValue,
  actorId: LegacyValue,
  taskId: LegacyValue,
) {
  const report = inspectTouchedPhysicalLineBudget(cwd, files, {
    taskId,
    actorId,
    gate: 'git-commit',
  });
  if (report.ok) return;
  throw new CliError(
    'ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED',
    `Governed commit blocked because touched source files exceed the physical line budget (${report.maxLines}).`,
    { exitCode: 1, details: report },
  );
}

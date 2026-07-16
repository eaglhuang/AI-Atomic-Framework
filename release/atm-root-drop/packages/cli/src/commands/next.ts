import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { readActiveGuidanceSession, toGuidanceNextAction } from '../../../core/src/guidance/index.ts';
import type { GuidanceNextAction } from '../../../core/src/guidance/guidance-packet.ts';
import type { LegacyRoutePlan, LegacyRoutePlanSegment } from '../../../core/src/guidance/legacy-route-plan.ts';
import {
  loadHumanReviewQueueDocument,
  type HumanReviewQueueRecord,
  type HumanReviewQueueStatus
} from '../../../plugin-human-review/src/index.ts';
import { buildFirstUseUserNotice, type AtmUserNotice } from './first-use-notice.ts';
import {
  compareScoredTasks,
  compareGuidedLegacyQueuePriority,
  compareIsoDesc,
  looksLikeTaskArtifact,
  isLikelyPromptPathHint,
  pathFieldMatches,
  looksLikeNamedPlanPrompt,
  allowsPlanningMirror,
  statusQueueWeight,
  humanReviewStatusWeight,
  tokenizeForMatch,
  countTokenOverlap,
  type NextDecisionTrailEntry
} from './next/match-and-sort.ts';
import { runDoctor } from './doctor.ts';
import { collectResolutionAuthorizedForeignTaskIds } from './broker-conflict-resolution.ts';
import {
  deriveBrokerVerdict,
  deriveCidVerdict,
  evaluateClaimAdmission,
  resolveEffectiveShouldBlockPerCid
} from './next/claim-admission.ts';
import { evaluateBrokerQueueAdmission, type BrokerQueueAdmission } from './next/broker-queue-admission.ts';
import { buildClaimAdmissionDecisionLog } from './next/claim-conflict-log.ts';
import { runBroker } from './broker.ts';
import {
  allowedGuidanceBootstrapCommands,
  blockedMutationCommands,
  decideRuntimeNextAction,
  selectPostClaimChannel,
  selectQuickfixChannel
} from './next/channel-strategy.ts';
import { buildGovernanceReadinessHintContract, type GovernanceChannel } from './next/governance-readiness.ts';
import { buildTaskScopedClaimCommand } from './next/task-scoped-claim-command.ts';
import { withRunnerMode } from './next/runner-mode.ts';
import {
  ensureDecisionTrail,
  readQueueHeadTaskId,
  readTaskId,
  type NextActionLike
} from './next/next-action-assembly.ts';
import { buildPromptScopedQueueClaimCommand } from './next/prompt-scope-resolution.ts';
import { shouldEmitPromptWorktreeHint } from './next/worktree-hints.ts';
import { bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.ts';
import { describeIntegrationInstallHint, inspectIntegrationBootstrap } from './integration.ts';
import { inspectRuntimeAdapterReadiness } from './runtime-adapter-readiness.ts';
import { describeActorResolution, resolveActorId } from './actor-registry.ts';
import { resolveActorWorkSession, upsertActorWorkSession } from './actor-session.ts';
import { assertSourceFirstRunnerReadOnlyAction, buildFrameworkTempClaimCommand, createFrameworkModeStatus } from './framework-development.ts';
import { classifyTaskDelivery, type TaskDeliveryClassification } from './task-intent.ts';
import { inspectBrokerClaimLifecycle, recordBrokerClaimIntent } from '../../../core/src/broker/lifecycle.ts';
import {
  abandonTaskQueue,
  buildAllowedFilesForTask,
  createOrRefreshTaskQueue,
  findActiveTaskQueue,
  isTaskDirectionPathCandidate,
  partitionTaskScope,
  readActiveTaskDirectionLocks,
  type TaskQueueRecord,
  writeTaskDirectionLock
} from './task-direction.ts';
import {
  extractPathLikeStringsFromPrompt,
  inspectBatchRunConsistency,
  isQuickfixPrompt,
  isPathAllowedByScope,
  listActiveBatchRuns,
  readActiveBatchRun,
  repairBatchRunFromQueue,
  writeBatchRun,
  writeQuickfixLock
} from './work-channels.ts';
import { buildBrokerConflictUxProjection, buildTeamRecommendation, type TeamRecommendation } from './team.ts';
import { buildTeamKnowledgeSummary } from './team-knowledge.ts';
import { decideActiveBatchClaimTask } from './next-active-batch.ts';
import { CliError, makeResult, message, parseJsonText, parseOptions, resolveNextDefaultOutputPath, setOutputJsonPath } from './shared.ts';
import {
  runTasks,
  findTaskClaimDependencyBlockers,
  prepareTaskForClaim,
  type TaskClaimDependencyBlocker
} from './tasks/public-surface.ts';
import { taskPathFor } from './tasks/task-file-io-helpers.ts';
import {
  parseMarkdownFrontmatter,
  normalizeTaskRouteStatus,
  normalizeOptionalBoolean,
  normalizeSearchText,
  normalizeTaskIntent,
  normalizeOrdinalScope,
  normalizeTaskIntentSource,
  normalizeRequestedTaskAction,
  normalizeOptionalTaskPath,
  readStringArray,
  splitListValue,
  type TaskIntentSource,
  type RequestedTaskAction,
  type TaskIntent
} from './next/intent-normalizers.ts';
import {
  areTaskDependenciesSatisfied,
  canTaskBePreparedForClaim,
  hasRequiredPromptScopeMatch,
  isClosedTaskStatus,
  isExplicitSingleTaskRoute,
  isFrameworkMaintenancePrompt,
  isQueueRequestedPrompt,
  isTaskAlreadyActivelyClaimed,
  isTaskCardSurfaceOnlyMatch,
  isTaskExplicitlyMentioned,
  isTaskRoutable,
  shouldDiscoverMarkdownTaskCards,
  type ImportedTaskQueue,
  type ImportedTaskSummary,
  type PromptScopedRouteStatus,
  type PromptScopedTaskRoute
} from './next/route-predicates.ts';
import {
  dedupeStrings,
  quoteCliValue,
  sha256,
  toTaskCandidateView,
  uniqueInOrder,
  uniqueSorted
} from './next/view-projections.ts';
import {
  readConfiguredPlanningRoots,
  shouldReportPlanningRootMissing
} from './planning-repo-root.ts';
import {
  resolveCandidatePlanningRoots
} from './next/planning-root-preference.ts';
import {
  buildNonPlaybookRouteHints,
  checkPendingTaskArtifactScopeExpansion,
  createDeterministicTaskIntent,
  detectRequestedTaskAction,
  extractPromptPathHints,
  findActiveBatchRunForIntent,
  findActiveTaskQueueForIntent,
  findNearbyPlanPaths,
  findTaskByTaskIdReference,
  finalizeImportedTaskSummary,
  hasPromptScopedWorkItems,
  isHandoffPrompt,
  isActiveClaimedTask,
  assertPromptBatchDoesNotConflict,
  isTaskIdMentioned,
  inspectImportedTaskQueue,
  listPromptScopedExternalTaskCardFiles,
  listTaskCardFiles,
  normalizeOptionalString,
  reconcilePromptScopeRuntimeForClaim,
  resolveTaskIntent,
  resolveQuickfixScope,
  withMirrorSyncOnlyTarget,
  withMirrorSyncOnlyTargetQueue,
  resolvePromptScopedTaskContext,
  resolvePromptScopedTaskRoute,
  extractDeclaredTaskPathsFromDocument,
  extractLinkedSourceTaskArtifactPaths,
  extractTaskArtifactPathsFromMarkdown,
  dedupeTasks,
  type ImportedTaskSummaryWithOutOfScope,
  buildMinimalImportedJsonTaskSummary
} from './next/route-resolution.ts';
import {
  buildActiveTaskDivergenceResult,
  buildActiveWorkSummary,
  buildAgentPackHint,
  buildChannelPlaybook,
  buildGovernanceReadinessHint,
  buildNextMessages,
  buildTaskDeliveryPrinciple,
  embedTeamRecommendation,
  enrichWithLegacyPlan,
  inspectFreshTaskReservationForTask,
  normalizeWorkPath,
  shouldInspectCrossRepoFrameworkStatus
} from './next/playbook-projection.ts';
import {
  buildPromptScopedNextResult
} from './next/prompt-results.ts';
export {
  resolvePromptScopedTaskContext,
  resolveHandoffResumeTaskRoute,
  shouldSkipExternalTaskCardScan,
  shouldSkipMarkdownTaskDiscovery,
  type PromptScopedTaskContext
} from './next/route-resolution.ts';
export { buildActiveWorkSummary } from './next/playbook-projection.ts';

import { compactNextRouteResult } from './next/result-compaction.ts';

export type NextCommandResult = {
  readonly ok?: boolean;
  readonly command?: string;
  readonly cwd?: string;
  readonly messages: Array<Record<string, any>>;
  readonly evidence: Record<string, any>;
  readonly [key: string]: any;
};

export async function runNext(argv: string[]): Promise<NextCommandResult> {
  const verbose = Array.isArray(argv) && argv.includes('--verbose');
  const routeArgv = verbose ? argv.filter((arg) => arg !== '--verbose') : argv;
  const result = await runNextRoute(routeArgv);
  return verbose ? result : compactNextRouteResult(result);
}

async function runNextRoute(argv: string[]): Promise<NextCommandResult> {
  const profile = createNextProfiler();
  // TASK-CID-0024: --claim-intent is a next-only claim flag; extract it before
  // the shared option parser so the rest of the surface stays unchanged.
  const claimIntentExtraction = extractClaimIntentFlag(Array.isArray(argv) ? argv : []);
  argv = claimIntentExtraction.argv;
  const claimIntent = claimIntentExtraction.claimIntent;
  const autoIntent = claimIntentExtraction.autoIntent;
  const outputFlagIndex = argv.indexOf('--output');
  if (outputFlagIndex !== -1) {
    const nextArg = argv[outputFlagIndex + 1];
    if (!nextArg || nextArg.startsWith('--')) {
      const cwd = process.cwd();
      setOutputJsonPath(resolveNextDefaultOutputPath(cwd));
    } else {
      setOutputJsonPath(path.resolve(nextArg));
    }
  }
  const { options } = parseOptions(argv, 'next');
  profile.mark('parse-options');
  const integrationBootstrap = inspectIntegrationBootstrap(options.cwd);
  profile.mark('inspect-integration-bootstrap');
  const runtimeAdapterReadiness = inspectRuntimeAdapterReadiness(options.cwd);
  profile.mark('inspect-runtime-adapter-readiness');
  const explicitTaskIds = uniqueInOrder([
    ...(typeof options.task === 'string' && options.task.trim().length > 0 ? [options.task] : []),
    ...(Array.isArray(options.tasks) ? options.tasks : [])
  ]);
  const taskIntent = resolveTaskIntent(options.cwd, {
    prompt: options.prompt,
    intentPath: options.intent,
    explicitTaskIds
  });
  profile.mark('resolve-task-intent');
  const importedTaskQueue = inspectImportedTaskQueue(options.cwd, taskIntent, claimIntent ?? 'write');
  profile.mark('inspect-imported-task-queue');
  const scopedTargetRepo = importedTaskQueue.promptScope?.targetRepo ?? null;
  const earlyFrameworkStatus = shouldInspectCrossRepoFrameworkStatus(options.cwd, scopedTargetRepo)
    ? createFrameworkModeStatus({
      cwd: options.cwd,
      targetRepo: scopedTargetRepo
    })
    : null;
  profile.mark(`create-framework-mode-status skipped=${earlyFrameworkStatus === null}`);
  if (earlyFrameworkStatus?.mode === 'cross-repo-target-required') {
    profile.flush('cross-repo-target-required');
    return withRunnerMode(buildCrossRepoFrameworkNextResult({
      cwd: options.cwd,
      frameworkStatus: earlyFrameworkStatus,
      integrationBootstrap,
      runtimeAdapterReadiness,
      importedTaskQueue
    }), options.cwd);
  }
  if (!taskIntent && hasPromptScopedWorkItems(importedTaskQueue)) {
    profile.mark('has-prompt-scoped-work-items');
    profile.flush('prompt-required');
    return withRunnerMode(buildPromptRequiredNextResult({
      cwd: options.cwd,
      claimRequested: Boolean(options.claim),
      importedTaskQueue,
      integrationBootstrap,
      runtimeAdapterReadiness
    }), options.cwd);
  }
  if (options.claim) {
    profile.flush('claim-route');
    return withRunnerMode(await claimNextImportedTask({
      cwd: options.cwd,
      actor: options.agent,
      claimIntent,
      autoIntent,
      forceClaim: Boolean(options.force),
      claimFiles: options.files,
      taskIntent,
      importedTaskQueue,
      integrationBootstrap,
      runtimeAdapterReadiness
    }), options.cwd);
  }
  const activeTaskDivergenceResult = buildActiveTaskDivergenceResult({
    cwd: options.cwd,
    taskIntent,
    importedTaskQueue,
    integrationBootstrap,
    runtimeAdapterReadiness
  });
  profile.mark('build-active-task-divergence-result');
  if (activeTaskDivergenceResult) {
    profile.flush('active-task-divergence-result');
    return withRunnerMode(activeTaskDivergenceResult, options.cwd);
  }
  const promptScopeResult = buildPromptScopedNextResult({
    cwd: options.cwd,
    actor: options.agent,
    taskIntent,
    importedTaskQueue,
    integrationBootstrap,
    runtimeAdapterReadiness
  });
  profile.mark('build-prompt-scoped-next-result');
  if (promptScopeResult) {
    profile.flush('prompt-scope-result');
    return withRunnerMode(promptScopeResult, options.cwd);
  }
  const promptGuidanceResult = buildPromptGuidanceNextResult({
    cwd: options.cwd,
    actor: options.agent,
    taskIntent,
    integrationBootstrap,
    runtimeAdapterReadiness
  });
  profile.mark('build-prompt-guidance-next-result');
  if (promptGuidanceResult) {
    profile.flush('prompt-guidance-result');
    return withRunnerMode(promptGuidanceResult, options.cwd);
  }
  const activeGuidanceSession = readActiveGuidanceSession(options.cwd);
  profile.mark('read-active-guidance-session');
  if (activeGuidanceSession) {
    const baseAction = toGuidanceNextAction(activeGuidanceSession.packet, activeGuidanceSession.routeDecision.blockedBy);
    const legacyPlan = activeGuidanceSession.legacyRoutePlan ?? null;
    const nextAction = legacyPlan ? enrichWithLegacyPlan(options.cwd, baseAction, legacyPlan, activeGuidanceSession.sessionId) : baseAction;
    const userNotice = buildFirstUseUserNotice(nextAction as Parameters<typeof buildFirstUseUserNotice>[0]);
    profile.flush('active-guidance-session');
    return withRunnerMode(makeResult({
      ok: nextAction.status !== 'blocked',
      command: 'next',
      cwd: options.cwd,
      messages: buildNextMessages(
        nextAction,
        userNotice,
        integrationBootstrap,
        runtimeAdapterReadiness,
        nextAction.status === 'blocked'
          ? message('info', 'ATM_GUIDANCE_NEXT_BLOCKED', 'ATM guidance identified the next single action.', nextAction)
          : message('info', 'ATM_GUIDANCE_NEXT_ACTION', 'ATM guidance identified the next single action.', nextAction)
      ),
      evidence: {
        nextAction,
        agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
        ...(userNotice ? { userNotice } : {}),
        integrationBootstrap,
        runtimeAdapterReadiness,
        taskIntent,
        importedTaskQueue,
        guidanceSession: {
          sessionId: activeGuidanceSession.sessionId,
          goal: activeGuidanceSession.goal,
          recommendedRoute: activeGuidanceSession.routeDecision.recommendedRoute,
          confidence: activeGuidanceSession.routeDecision.confidence
        }
      }
    }), options.cwd);
  }

  const doctor = await runDoctor(['--cwd', options.cwd]);
  profile.mark('run-doctor');
  const runtime = detectGovernanceRuntime(options.cwd, bootstrapTaskId);
  profile.mark('detect-governance-runtime');
  const doctorChecks = doctor.evidence.checks as Array<{ name: string; ok: boolean }>;
  const failed = doctorChecks.find((check) => check.ok !== true);
  const nextAction = decideRuntimeNextAction(runtime, failed?.name ?? null, importedTaskQueue);
  const userNotice = buildFirstUseUserNotice(nextAction);
  profile.flush('default-next');
  return withRunnerMode(makeResult({
    ok: nextAction.status === 'ready',
    command: 'next',
    cwd: options.cwd,
    messages: buildNextMessages(
      nextAction,
      userNotice,
      integrationBootstrap,
      runtimeAdapterReadiness,
      nextAction.status === 'ready'
        ? message('info', 'ATM_NEXT_READY', 'ATM is ready for the next governed task.', nextAction)
        : message('info', 'ATM_NEXT_ACTION', 'ATM identified the next single governed action.', nextAction)
    ),
    evidence: {
      nextAction,
      agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
      ...(userNotice ? { userNotice } : {}),
      integrationBootstrap,
      runtimeAdapterReadiness,
      taskIntent,
      importedTaskQueue,
      doctorSummary: doctorChecks.map((check) => ({ name: check.name, ok: check.ok })),
      layoutVersion: runtime.layoutVersion,
      currentTaskId: runtime.currentTaskId,
      lockOwner: runtime.activeLock?.owner ?? null,
      lastEvidenceAt: runtime.lastEvidenceAt,
      lastHandoffAt: runtime.lastHandoffAt
    }
  }), options.cwd);
}

import { createNextProfiler } from './next/profiler.ts';
import { claimNextImportedTask, extractClaimIntentFlag } from './next/claim-orchestration.ts';
import { buildCrossRepoFrameworkNextResult } from './next/cross-repo-framework-result.ts';
export {
  diagnoseClaimReadinessForTasks,
  type ClaimReadinessDiagnostic,
  type ClaimReadinessReport,
  type ClaimReadinessTaskSummary,
  type NextClaimIntent
} from './next/claim-orchestration.ts';
import { buildPromptGuidanceNextResult, buildPromptRequiredNextResult } from './next/prompt-guidance-result.ts';

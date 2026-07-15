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

const NEXT_LARGE_ARRAY_TRUNCATION_LIMIT = 20;
const NEXT_FRESH_TASK_RESERVATION_TTL_SECONDS = 30 * 60;
const NEXT_TRUNCATABLE_FRAMEWORK_STATUS_FIELDS = ['changedFiles', 'criticalChangedFiles', 'docsOnlyChangedFiles'] as const;
const NEXT_DUPLICATED_TOP_LEVEL_KEYS = [
  'nextAction',
  'taskIntent',
  'userNotice',
  'runnerMode',
  'frameworkReport',
  'frameworkClaim',
  'evidenceSummary',
  'guardReport',
  'taskflowReadiness',
  'commitBundle',
  'allowedCommands',
  'blockedCommands',
  'skillGrowth'
] as const;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactFrameworkStatusFileLists(frameworkStatus: Record<string, unknown>): Record<string, unknown> {
  const compacted: Record<string, unknown> = { ...frameworkStatus };
  for (const field of NEXT_TRUNCATABLE_FRAMEWORK_STATUS_FIELDS) {
    const value = frameworkStatus[field];
    if (Array.isArray(value) && value.length > NEXT_LARGE_ARRAY_TRUNCATION_LIMIT) {
      compacted[field] = value.slice(0, NEXT_LARGE_ARRAY_TRUNCATION_LIMIT);
      compacted[`${field}Truncated`] = true;
      compacted[`${field}TotalCount`] = value.length;
    }
  }
  return compacted;
}

function compactPlaybookMessageData(data: Record<string, unknown>): Record<string, unknown> {
  // steps/doNot/commandSequence/governedGitEntrypoint are already the
  // authoritative content at evidence.nextAction.playbook; echoing them again
  // inside this message is what made ordinary routes balloon in size.
  const { steps: _steps, doNot: _doNot, commandSequence: _commandSequence, governedGitEntrypoint: _governedGitEntrypoint, ...rest } = data;
  return {
    ...rest,
    fullPlaybookPath: 'evidence.nextAction.playbook'
  };
}

/**
 * Trims the default `next` CLI envelope so ordinary prompt-scoped routes stay
 * readable in agent/tool transcripts. This only removes duplicated or
 * oversized diagnostic content that remains fully reachable elsewhere
 * (evidence.nextAction.playbook stays untouched; framework-mode status --json
 * keeps the full file lists). Pass --verbose to bypass this and get the
 * original untrimmed envelope. See ATM-BUG-2026-07-07-041.
 */
function compactNextRouteResult<T extends { evidence?: Record<string, unknown>; messages?: unknown[] }>(result: T): T {
  const evidence = result.evidence;
  const compactedEvidence = evidence && isPlainRecord(evidence.frameworkStatus)
    ? { ...evidence, frameworkStatus: compactFrameworkStatusFileLists(evidence.frameworkStatus), suppressToolBridgeProjection: true }
    : evidence
      ? { ...evidence, suppressToolBridgeProjection: true }
      : evidence;
  const messages = Array.isArray(result.messages)
    ? result.messages.map((entry) => {
      const record = isPlainRecord(entry) ? entry : null;
      if (record && record.code === 'ATM_CHANNEL_PLAYBOOK_REQUIRED' && isPlainRecord(record.data)) {
        return { ...record, data: compactPlaybookMessageData(record.data) };
      }
      return entry;
    })
    : result.messages;
  const compacted: Record<string, unknown> = {
    ...result,
    ...(compactedEvidence ? { evidence: compactedEvidence } : {}),
    ...(messages ? { messages } : {})
  };
  for (const key of NEXT_DUPLICATED_TOP_LEVEL_KEYS) {
    delete compacted[key];
  }
  return compacted as T;
}

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

function createNextProfiler(header = 'ATM_NEXT_PROFILE') {
  const enabled = process.env.ATM_NEXT_PROFILE === '1';
  const startedAt = Date.now();
  let previousAt = startedAt;
  const marks: string[] = [];
  return {
    mark(label: string) {
      if (!enabled) return;
      const now = Date.now();
      marks.push(`${label}: +${now - previousAt}ms (${now - startedAt}ms)`);
      previousAt = now;
    },
    flush(label: string) {
      if (!enabled) return;
      const now = Date.now();
      marks.push(`${label}: +${now - previousAt}ms (${now - startedAt}ms)`);
      process.stderr.write(`[${header}]\n${marks.join('\n')}\n`);
    }
  };
}

// TASK-CID-0024: claim intent for next --claim.
// 'write' is the default mutating claim. 'closeout-only' (alias
// 'no-more-mutation') declares that the scoped deliverable already landed and
// the claim only needs governed closeout continuity, so parallel CID write
// conflicts are downgraded to advisory instead of blocking the claim.
export type NextClaimIntent = 'write' | 'closeout-only';

export interface ClaimReadinessTaskSummary {
  readonly workItemId: string;
  readonly status: string;
  readonly format: 'json' | 'markdown';
  readonly sourcePlanPath: string | null;
}

export interface ClaimReadinessDiagnostic {
  readonly taskId: string;
  readonly status: string;
  readonly format: 'json' | 'markdown';
  readonly claimable: boolean;
  readonly blockerCode: string;
  readonly blockerSummary: string;
  readonly requiredCommand: string | null;
  readonly dependencyBlockers: readonly TaskClaimDependencyBlocker[];
}

export interface ClaimReadinessReport {
  readonly schemaId: 'atm.claimReadinessReport.v1';
  readonly diagnostics: readonly ClaimReadinessDiagnostic[];
  readonly primaryBlocker: ClaimReadinessDiagnostic | null;
}

function extractClaimIntentFlag(argv: readonly string[]): { argv: string[]; claimIntent: NextClaimIntent | null; autoIntent: boolean } {
  const remaining: string[] = [];
  let claimIntent: NextClaimIntent | null = null;
  let autoIntent = true;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--auto-intent') {
      autoIntent = true;
      continue;
    }
    if (arg === '--claim-intent') {
      const raw = String(argv[index + 1] ?? '').trim().toLowerCase();
      const normalized = raw === 'no-more-mutation' ? 'closeout-only' : raw;
      if (normalized !== 'write' && normalized !== 'closeout-only') {
        throw new CliError('ATM_CLI_USAGE', 'next --claim requires --claim-intent to be one of: write, closeout-only, no-more-mutation.', {
          exitCode: 2,
          details: { claimIntent: raw, allowedValues: ['write', 'closeout-only', 'no-more-mutation'] }
        });
      }
      claimIntent = normalized;
      autoIntent = false;
      index += 1;
      continue;
    }
    if (arg === '--closeout-only' || arg === '--no-more-mutation') {
      claimIntent = 'closeout-only';
      autoIntent = false;
      continue;
    }
    remaining.push(arg);
  }
  return { argv: remaining, claimIntent, autoIntent };
}

export function diagnoseClaimReadinessForTasks(
  cwd: string,
  tasks: readonly ClaimReadinessTaskSummary[],
  claimIntent: NextClaimIntent
): ClaimReadinessReport {
  const diagnostics: ClaimReadinessDiagnostic[] = [];
  for (const task of tasks) {
    const status = normalizeTaskRouteStatus(task.status);
    const claimable = canTaskBePreparedForClaim(status) || (status === 'review' && claimIntent === 'closeout-only');
    if (task.format === 'markdown') {
      diagnostics.push({
        taskId: task.workItemId,
        status,
        format: task.format,
        claimable: false,
        blockerCode: 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED',
        blockerSummary: `Task ${task.workItemId} is still a Markdown task card and must be imported before claim.`,
        requiredCommand: task.sourcePlanPath
          ? `node atm.mjs tasks import --from ${quoteCliValue(task.sourcePlanPath)} --dry-run --cwd . --json`
          : 'node atm.mjs tasks import --from <plan.md> --dry-run --cwd . --json',
        dependencyBlockers: []
      });
      continue;
    }
    if (status === 'review' && claimIntent !== 'closeout-only') {
      diagnostics.push({
        taskId: task.workItemId,
        status,
        format: task.format,
        claimable: false,
        blockerCode: 'ATM_NEXT_CLAIM_REVIEW_CLOSEOUT_ONLY_REQUIRED',
        blockerSummary: `Task ${task.workItemId} is in review; reclaim it only through closeout-only when no more source mutation is needed.`,
        requiredCommand: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(task.workItemId)} --claim-intent closeout-only --json`,
        dependencyBlockers: []
      });
      continue;
    }
    const taskPath = taskPathFor(cwd, task.workItemId);
    const dependencyBlockers = existsSync(taskPath)
      ? (() => {
        try {
          const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
          return findTaskClaimDependencyBlockers(cwd, task.workItemId, taskDocument);
        } catch {
          return [];
        }
      })()
      : [];
    if (dependencyBlockers.length > 0) {
      const firstBlocker = dependencyBlockers[0];
      diagnostics.push({
        taskId: task.workItemId,
        status,
        format: task.format,
        claimable: false,
        blockerCode: 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED',
        blockerSummary: firstBlocker.status === 'source-done-governance-incomplete'
          ? `Task ${task.workItemId} is blocked because prerequisite ${firstBlocker.taskId} is source-done but not governably closed.`
          : `Task ${task.workItemId} is blocked until prerequisite task(s) close.`,
        requiredCommand: firstBlocker.requiredCommand
          ?? (firstBlocker.status === 'incomplete-closeout' || firstBlocker.status === 'source-done-governance-incomplete'
            ? `node atm.mjs tasks status --task ${firstBlocker.taskId} --residue --json`
            : `node atm.mjs tasks status --task ${firstBlocker.taskId} --json`),
        dependencyBlockers
      });
      continue;
    }
    if (!claimable) {
      diagnostics.push({
        taskId: task.workItemId,
        status,
        format: task.format,
        claimable: false,
        blockerCode: 'ATM_NEXT_CLAIM_NOT_READY',
        blockerSummary: `Task ${task.workItemId} is currently ${status} and cannot be claimed yet.`,
        requiredCommand: `node atm.mjs tasks status --task ${task.workItemId} --json`,
        dependencyBlockers: []
      });
      continue;
    }
    diagnostics.push({
      taskId: task.workItemId,
      status,
      format: task.format,
      claimable: true,
      blockerCode: 'ATM_NEXT_CLAIM_READY',
      blockerSummary: `Task ${task.workItemId} can be prepared for claim.`,
      requiredCommand: `node atm.mjs next --claim --actor <id> --task ${task.workItemId} --auto-intent --json`,
      dependencyBlockers: []
    });
  }
  const primaryBlocker = diagnostics.find((entry) => !entry.claimable) ?? null;
  return {
    schemaId: 'atm.claimReadinessReport.v1',
    diagnostics,
    primaryBlocker
  };
}

function buildCrossRepoFrameworkNextResult(input: {
  readonly cwd: string;
  readonly frameworkStatus: ReturnType<typeof createFrameworkModeStatus>;
  readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
  readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
  readonly importedTaskQueue: ImportedTaskQueue | null;
}) {
  const targetRepo = input.frameworkStatus.targetRepo ?? '<target-repo>';
  const nextAction = {
    status: 'blocked',
    command: `cd ${quoteCliValue(targetRepo)} ; node atm.mjs framework-mode status --json`,
    reason: 'the current task metadata points to ATM framework work; closure authority and hard gates must run in the target framework repository',
    frameworkMode: input.frameworkStatus.mode,
    targetRepo,
    closureAuthority: input.frameworkStatus.closureAuthority,
    allowedCommands: [
      `cd ${quoteCliValue(targetRepo)} ; node atm.mjs framework-mode status --json`,
      `cd ${quoteCliValue(targetRepo)} ; node atm.mjs next --claim --actor <id> --json`
    ],
    blockedCommands: [
      'editing framework critical files while cwd is the planning repository',
      'closing framework target tasks from the planning repository'
    ]
  };
  const userNotice = buildFirstUseUserNotice(nextAction as Parameters<typeof buildFirstUseUserNotice>[0]);
  return makeResult({
    ok: false,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction as NextActionLike,
      userNotice,
      input.integrationBootstrap,
      input.runtimeAdapterReadiness,
      message('error', 'ATM_NEXT_FRAMEWORK_TARGET_REPO_REQUIRED', 'ATM framework work was detected from task metadata; switch to the target framework repo before mutating or closing work.', {
        targetRepo,
        closureAuthority: input.frameworkStatus.closureAuthority
      })
    ),
    evidence: {
      nextAction,
      frameworkStatus: input.frameworkStatus,
      importedTaskQueue: input.importedTaskQueue,
      integrationBootstrap: input.integrationBootstrap,
      runtimeAdapterReadiness: input.runtimeAdapterReadiness
    }
  });
}

async function claimNextImportedTask(input: {
  readonly cwd: string;
  readonly actor: string | undefined;
  readonly claimIntent?: NextClaimIntent | null;
  readonly autoIntent?: boolean;
  readonly forceClaim?: boolean;
  readonly claimFiles?: readonly string[];
  readonly taskIntent: TaskIntent | null;
  readonly importedTaskQueue: ImportedTaskQueue;
  readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
  readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}) {
  assertSourceFirstRunnerReadOnlyAction({ cwd: input.cwd, action: 'next --claim' });
  const claimStartedAt = Date.now();
  const claimLatencyPhases: Array<{ readonly phase: string; readonly durationMs: number }> = [];
  const claimIntent: NextClaimIntent = input.claimIntent ?? 'write';
  const autoIntent = input.autoIntent !== false && input.claimIntent == null;
  const promptScopeRuntime = input.importedTaskQueue.promptScope?.status === 'queue'
    ? reconcilePromptScopeRuntimeForClaim(input.cwd, input.taskIntent, input.importedTaskQueue.promptScope.selectedTasks)
    : null;
  const importedTaskQueue = promptScopeRuntime
    ? {
      ...input.importedTaskQueue,
      claimableTask: promptScopeRuntime.queueHeadTask ?? input.importedTaskQueue.claimableTask,
      selectedTask: promptScopeRuntime.queueHeadTask ?? input.importedTaskQueue.selectedTask
    }
    : input.importedTaskQueue;
  const promptText = input.taskIntent?.userPrompt?.trim() ?? '';
  const quickfixScope = promptText ? resolveQuickfixScope(promptText) : [];
  if (!importedTaskQueue.claimableTask
    && !importedTaskQueue.promptScope
    && isQuickfixPrompt(promptText)
    && quickfixScope.length > 0) {
    const resolvedActor = resolveActorId(input.actor ?? undefined, input.cwd);
    if (!resolvedActor) {
      throw new CliError('ATM_ACTOR_ID_MISSING', 'next --claim requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    const quickfixLock = writeQuickfixLock({
      cwd: input.cwd,
      actorId: resolvedActor.actorId,
      prompt: promptText,
      reason: promptText,
      allowedFiles: quickfixScope
    });
    const quickfixChannel = selectQuickfixChannel();
    const nextAction: NextActionLike = {
      status: 'ready',
      command: 'Apply the quickfix within the allowed files and commit normally.',
      reason: `claimed ATM quickfix lock for ${resolvedActor.actorId}`,
      recommendedChannel: quickfixChannel.recommendedChannel,
      riskLevel: quickfixChannel.riskLevel,
      playbook: buildChannelPlaybook({
        channel: 'fast',
        originalPrompt: promptText,
        actorPlaceholder: resolvedActor.actorId
      }),
      quickfixLock
    };
    return makeResult({
      ok: true,
      command: 'next',
      cwd: input.cwd,
      messages: buildNextMessages(
        nextAction,
        null,
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
        message('info', 'ATM_NEXT_QUICKFIX_CLAIMED', 'Acquired a quickfix lock from next --claim.', {
          actorId: resolvedActor.actorId,
          allowedFiles: quickfixLock.allowedFiles
        })
      ),
      evidence: {
        nextAction,
        recommendedChannel: 'fast',
        quickfixLock,
        taskIntent: input.taskIntent,
        importedTaskQueue,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  const claimDependencyStatusById = new Map(
    importedTaskQueue.tasks.map((task) => [task.workItemId, task.status] as const)
  );
  const selectedTask = importedTaskQueue.claimableTask || importedTaskQueue.selectedTask;
  let selectedTaskDependencyBlockers: TaskClaimDependencyBlocker[] = [];
  if (selectedTask) {
    const taskPath = taskPathFor(input.cwd, selectedTask.workItemId);
    if (existsSync(taskPath)) {
      try {
        const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
        selectedTaskDependencyBlockers = findTaskClaimDependencyBlockers(input.cwd, selectedTask.workItemId, taskDocument);
      } catch {}
    }
  }
  const reusesOwnActiveClaim = Boolean(
    selectedTask
    && isTaskAlreadyActivelyClaimed(selectedTask)
    && typeof input.actor === 'string'
    && input.actor.trim().length > 0
    && selectedTask.activeClaimActorId === input.actor.trim()
  );
  if (selectedTaskDependencyBlockers.length > 0 && !reusesOwnActiveClaim) {
    const firstBlocker = selectedTaskDependencyBlockers[0];
    const requiredCmd = firstBlocker.requiredCommand
      ?? (firstBlocker.status === 'incomplete-closeout' || firstBlocker.status === 'source-done-governance-incomplete'
        ? `node atm.mjs tasks status --task ${firstBlocker.taskId} --residue --json`
        : `node atm.mjs tasks status --task ${firstBlocker.taskId} --json`);
    const blockerText = firstBlocker.status === 'source-done-governance-incomplete'
      ? `Claim blocked: prerequisite ${firstBlocker.taskId} is source-done but not governably closed.`
      : `Claim blocked until prerequisite task(s) close for ${selectedTask?.workItemId ?? 'the selected task'}.`;
    return makeResult({
      ok: false,
      command: 'next',
      cwd: input.cwd,
      messages: [message('error', 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED', blockerText, {
        taskId: selectedTask?.workItemId ?? null,
        blockingTaskIds: selectedTaskDependencyBlockers.map((b) => b.taskId),
        requiredCommand: requiredCmd,
        dependencyStatuses: selectedTaskDependencyBlockers
      })],
      evidence: {
        taskIntent: input.taskIntent,
        importedTaskQueue
      }
    });
  }
  if (!importedTaskQueue.claimableTask) {
    const claimReadiness = diagnoseClaimReadinessForTasks(
      input.cwd,
      importedTaskQueue.promptScope?.selectedTasks ?? importedTaskQueue.tasks,
      claimIntent
    );
    const primaryBlocker = claimReadiness.primaryBlocker;
    const selectedReviewTask = importedTaskQueue.selectedTask
      && normalizeTaskRouteStatus(importedTaskQueue.selectedTask.status) === 'review'
      ? importedTaskQueue.selectedTask
      : null;
    if (selectedReviewTask && claimIntent !== 'closeout-only') {
      const requiredCommand = `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(selectedReviewTask.workItemId)} --claim-intent closeout-only --json`;
      return makeResult({
        ok: false,
        command: 'next',
        cwd: input.cwd,
        messages: [message('error', 'ATM_NEXT_CLAIM_REVIEW_CLOSEOUT_ONLY_REQUIRED', `Task ${selectedReviewTask.workItemId} is in review; reclaim it only through the closeout-only lane when no more source mutation is needed.`, {
          taskId: selectedReviewTask.workItemId,
          status: normalizeTaskRouteStatus(selectedReviewTask.status),
          requiredCommand,
          remediation: 'Use closeout-only with command-backed historical delivery evidence, or leave the task in review until a real deliverable exists.'
        })],
        evidence: {
          taskIntent: input.taskIntent,
          importedTaskQueue: input.importedTaskQueue
        }
      });
    }
    const claimCode = importedTaskQueue.promptScope?.selectedTasks.some((task) => task.format === 'markdown')
      ? 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED'
      : 'ATM_NEXT_CLAIM_NO_TASK';
    const singleVisibleTask = importedTaskQueue.tasks.length === 1 ? importedTaskQueue.tasks[0] : null;
    const promptScopeMiss = !importedTaskQueue.promptScope && !primaryBlocker && singleVisibleTask;
    const claimText = primaryBlocker?.blockerSummary
      ?? (promptScopeMiss
        ? `Prompt did not resolve to a scoped imported task. ATM found ${singleVisibleTask.workItemId}, but it will not auto-claim unrelated open work from an unscoped prompt.`
        : null)
      ?? (claimCode === 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED'
        ? 'The prompt-scoped task is a Markdown task card; import or mirror it into the ATM task ledger before claim.'
        : 'No claimable imported task is ready at the moment.');
    return makeResult({
      ok: false,
      command: 'next',
      cwd: input.cwd,
      messages: [message('error', claimCode, claimText, {
        requiredCommand: primaryBlocker?.requiredCommand
          ?? (promptScopeMiss
            ? `node atm.mjs next --claim --actor <id> --task ${singleVisibleTask.workItemId} --auto-intent --json`
            : null)
          ?? (importedTaskQueue.promptScope?.selectedTasks[0]?.sourcePlanPath
            ? `node atm.mjs tasks import --from ${quoteCliValue(importedTaskQueue.promptScope.selectedTasks[0].sourcePlanPath ?? '')} --dry-run --cwd . --json`
            : 'node atm.mjs tasks import --from <plan.md> --dry-run --cwd . --json'),
        primaryBlocker,
        claimReadiness
      })],
      evidence: {
        taskIntent: input.taskIntent,
        importedTaskQueue,
        claimReadiness
      }
    });
  }
  const actorResolution = describeActorResolution(input.actor ?? undefined, input.cwd);
  const resolvedActor = actorResolution.resolved;
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'next --claim requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const activeQueueForIntent = findActiveTaskQueueForIntent(input.cwd, input.taskIntent, {
    taskId: importedTaskQueue.claimableTask?.workItemId ?? null
  });
  const activeBatchForIntent = promptScopeRuntime?.batchRun
    ?? (activeQueueForIntent?.batchId
      ? readActiveBatchRun(input.cwd, { batchId: activeQueueForIntent.batchId })
      : findActiveBatchRunForIntent(input.cwd, input.taskIntent, {
        taskId: importedTaskQueue.claimableTask?.workItemId ?? null
      }));
  assertPromptBatchDoesNotConflict({
    cwd: input.cwd,
    promptScope: importedTaskQueue.promptScope,
    allTasks: importedTaskQueue.tasks,
    sourcePrompt: input.taskIntent?.userPrompt ?? null,
    currentBatchId: activeBatchForIntent?.batchId ?? null
  });
  let claimableTask = importedTaskQueue.claimableTask;
  const activeBatchAtClaimStart = importedTaskQueue.promptScope?.status === 'queue'
    ? activeBatchForIntent
    : readActiveBatchRun(input.cwd, { taskId: claimableTask?.workItemId ?? null });
  if (activeBatchAtClaimStart?.status === 'active') {
    const activeBatchQueue = activeQueueForIntent
      ?? findActiveTaskQueue(input.cwd, activeBatchAtClaimStart.sourcePrompt, { batchId: activeBatchAtClaimStart.batchId });
    const consistency = inspectBatchRunConsistency(activeBatchAtClaimStart, activeBatchQueue);
    if (!consistency.ok) {
      throw new CliError('ATM_BATCH_STATE_REPAIR_REQUIRED', 'next --claim cannot continue because batch-run and task-queue runtime disagree.', {
        exitCode: 1,
        details: {
          batchId: activeBatchAtClaimStart.batchId,
          reason: consistency.reason,
          batchHeadTaskId: consistency.batchHeadTaskId,
          queueHeadTaskId: consistency.queueHeadTaskId,
          requiredCommand: `node atm.mjs batch repair --actor ${resolvedActor.actorId} --batch ${activeBatchAtClaimStart.batchId} --json`
        }
      });
    }
  }
  if (activeBatchAtClaimStart?.status === 'active' && claimableTask) {
    const batchPromptQueue = inspectImportedTaskQueue(input.cwd, createDeterministicTaskIntent(activeBatchAtClaimStart.sourcePrompt), claimIntent);
    const activeBatchClaimDecision = decideActiveBatchClaimTask({
      activeBatch: activeBatchAtClaimStart,
      activeQueue: promptScopeRuntime?.queue
        ?? activeQueueForIntent
        ?? findActiveTaskQueue(input.cwd, activeBatchAtClaimStart.sourcePrompt, { batchId: activeBatchAtClaimStart.batchId }),
      claimableTask,
      visibleTasks: importedTaskQueue.tasks,
      fallbackTasks: batchPromptQueue.tasks
    });
    if (activeBatchClaimDecision?.kind === 'queue-head-missing') {
      throw new CliError('ATM_BATCH_QUEUE_HEAD_REQUIRED', `Batch ${activeBatchClaimDecision.batchId} is active, but ATM could not resolve queue head ${activeBatchClaimDecision.currentTaskId}.`, {
        exitCode: 1,
        details: {
          batchId: activeBatchClaimDecision.batchId,
          currentTaskId: activeBatchClaimDecision.currentTaskId,
          attemptedTaskId: activeBatchClaimDecision.attemptedTaskId,
          requiredCommand: `node atm.mjs next --claim --actor ${resolvedActor.actorId} --prompt ${quoteCliValue(activeBatchClaimDecision.requiredPrompt)} --json`
        }
      });
    }
    if (activeBatchClaimDecision?.kind === 'use-queue-head') {
      claimableTask = activeBatchClaimDecision.task;
    }
  }
  const freshForeignReservation = inspectFreshTaskReservationForTask(input.cwd, claimableTask, resolvedActor.actorId, Date.now());
  if (freshForeignReservation && !input.forceClaim) {
    const activeWorkSummary = buildActiveWorkSummary(input.cwd, resolvedActor.actorId, buildAllowedFilesForTask(claimableTask));
    const overrideCommand = `node atm.mjs next --claim --actor ${resolvedActor.actorId} --task ${claimableTask.workItemId} --auto-intent --force --json`;
    throw new CliError('ATM_NEXT_FRESH_FOREIGN_TASK_RESERVED', `Task ${claimableTask.workItemId} was freshly created or imported by ${freshForeignReservation.actorId}; do not auto-claim it as ${resolvedActor.actorId}.`, {
      exitCode: 1,
      details: {
        taskId: claimableTask.workItemId,
        reservedByActorId: freshForeignReservation.actorId,
        createdAt: freshForeignReservation.createdAt,
        importedAt: freshForeignReservation.importedAt,
        ageSeconds: freshForeignReservation.ageSeconds,
        ttlSeconds: freshForeignReservation.ttlSeconds,
        leaseFresh: freshForeignReservation.leaseFresh,
        files: freshForeignReservation.files,
        teamLevelRecommendation: activeWorkSummary.teamLevelRecommendation,
        brokerRecommendation: activeWorkSummary.brokerRecommendation,
        requiredCommand: `node atm.mjs next --claim --actor ${freshForeignReservation.actorId} --task ${claimableTask.workItemId} --auto-intent --json`,
        overrideCommand,
        recoveryHint: 'Ask the creating captain to hand off, wait for the fresh-task reservation TTL to expire, or use Team Broker override before forcing takeover.'
      }
    });
  }
  if (normalizeTaskRouteStatus(claimableTask.status) === 'reserved' && !claimableTask.activeClaimActorId) {
    await runTasks([
      'release',
      '--cwd',
      input.cwd,
      '--task',
      claimableTask.workItemId,
      '--actor',
      resolvedActor.actorId,
      '--reserved-ok',
      '--reason',
      'next --claim stale reserved cleanup',
      '--json'
    ]);
    claimableTask = {
      ...claimableTask,
      status: 'open'
    };
  }
  const existingClaimActorId = claimableTask.activeClaimActorId;
  if (existingClaimActorId && existingClaimActorId !== resolvedActor.actorId) {
    throw new CliError('ATM_LOCK_CONFLICT', `Task ${claimableTask.workItemId} is already claimed by ${existingClaimActorId}.`, {
      exitCode: 1,
      details: {
        taskId: claimableTask.workItemId,
        actorId: existingClaimActorId,
        requestedActorId: resolvedActor.actorId,
        actorResolution,
        recoveryHint: existingClaimActorId === actorResolution.repoDefaultActorId
          ? `Continue with the existing claim owner ${existingClaimActorId}, or rerun with --actor ${existingClaimActorId}.`
          : `Continue with the existing claim owner ${existingClaimActorId}, or release/take over the task before claiming as ${resolvedActor.actorId}.`
      }
    });
  }
  let parallelAdvisory: Record<string, unknown> | undefined = undefined;
  let brokerQueueAdmission: BrokerQueueAdmission | undefined = undefined;
  let claimAllowedFiles = (input.claimFiles && input.claimFiles.length > 0)
    ? uniqueSorted(input.claimFiles.map(normalizeWorkPath).filter(Boolean))
    : buildAllowedFilesForTask(claimableTask);
  // Parallel preflight check
  const parallelStartedAt = Date.now();
  try {
    const parallelResult = await runTasks([
      'parallel',
      '--task',
      claimableTask.workItemId,
      '--queue',
      '--cwd',
      input.cwd,
      '--json'
    ]);
    if (parallelResult && parallelResult.ok && parallelResult.evidence && Array.isArray(parallelResult.evidence.candidates)) {
      for (const candidate of parallelResult.evidence.candidates) {
        const finding = candidate.finding;
        if (finding) {
          const overlappingAtomIds = Array.isArray(finding.overlappingAtomIds) ? finding.overlappingAtomIds : [];
          const overlappingFiles = Array.isArray(finding.overlappingFiles)
            ? finding.overlappingFiles.map((entry: unknown) => String(entry).trim()).filter(Boolean)
            : [];
          // Queue admission is driven by concrete writable surfaces, not only
          // CID overlap. A CID-disjoint same-file finding still needs the
          // shared file removed from the waiter's direction lock.
          if (finding.verdict === 'blocked-cid-conflict' || overlappingAtomIds.length > 0 || overlappingFiles.length > 0) {
            // TASK-CID-0024: same-file / same-atom overlap only blocks the
            // claim when the overlapping task is actively write-claimed by
            // another actor. Queued-but-idle overlaps and closeout-only
            // counterparts are admitted with an advisory so same-file
            // CID-disjoint parallel work stops being serialized by default.
            //
            // TASK-RFT-0011: route the final admission decision through the
            // `next.claim.admission` policy object so the block-vs-admit call
            // is unified with `broker register`'s conflict-matrix verdict. The
            // legacy CID diagnostic is preserved as a wrapper — divergence
            // (which should not happen) is surfaced as
            // `ATM_CLAIM_ADMISSION_BROKER_CID_DIVERGENCE` for future
            // regression detection.
            const conflictActorId = typeof candidate.activeClaimActorId === 'string' && candidate.activeClaimActorId.trim().length > 0
              ? candidate.activeClaimActorId
              : null;
            const conflictIntent = typeof candidate.activeClaimIntent === 'string' ? candidate.activeClaimIntent : null;
            const activeWriteConflict = Boolean(conflictActorId)
              && conflictActorId !== resolvedActor.actorId
              && conflictIntent !== 'closeout-only';
            const brokerAdmission = finding.brokerAdmission && typeof finding.brokerAdmission === 'object'
              ? finding.brokerAdmission as { confirmedConflict?: unknown; mutationIntentStatus?: unknown }
              : null;
            const confirmedBrokerConflict = brokerAdmission?.confirmedConflict === true;
            const insufficientMutationIntent = finding.verdict === 'insufficient-mutation-intent'
              || brokerAdmission?.mutationIntentStatus === 'missing';
            const { shouldBlockPerCid, cidVerdict } = deriveCidVerdict({
              claimIntent,
              activeWriteConflict,
              confirmedBrokerConflict,
              insufficientMutationIntent,
              overlappingAtomIdCount: overlappingAtomIds.length
            });
            const resolutionAuthorizedForeignTaskIds = collectResolutionAuthorizedForeignTaskIds(
              input.cwd,
              claimableTask.workItemId
            );
            const effectiveShouldBlockPerCid = resolveEffectiveShouldBlockPerCid({
              shouldBlockPerCid,
              conflictingTaskId: candidate.taskId,
              resolutionAuthorizedForeignTaskIds
            });
            const queueAdmission = evaluateBrokerQueueAdmission({
              cwd: input.cwd,
              taskId: claimableTask.workItemId,
              allowedFiles: claimAllowedFiles,
              overlappingFiles
            });
            if (queueAdmission.status === 'invalid') {
              throw new CliError('ATM_NEXT_CLAIM_BLOCKED', `broker-conflict-blocked: ${queueAdmission.reason}`, {
                exitCode: 1,
                details: { taskId: claimableTask.workItemId, brokerQueueAdmission: queueAdmission }
              });
            }
            if (queueAdmission.status === 'queued-blocked') {
              throw new CliError('ATM_NEXT_CLAIM_BLOCKED', `broker-conflict-blocked: ${queueAdmission.reason}`, {
                exitCode: 1,
                details: { taskId: claimableTask.workItemId, brokerQueueAdmission: queueAdmission }
              });
            }
            if (queueAdmission.status === 'queued-private-work') {
              brokerQueueAdmission = queueAdmission;
              claimAllowedFiles = queueAdmission.allowedFiles;
            }
            const sharedConflictSurfaces = overlappingFiles.length > 0
              ? overlappingFiles
              : (overlappingAtomIds.length > 0 ? overlappingAtomIds : ['<shared-path>']);
            const decisionClass = insufficientMutationIntent ? 'blocked' : 'serial-release';
            const decisionReason = insufficientMutationIntent
              ? 'broker-conflict-blocked because active task overlap lacks a confirmed Broker mutation intent or resolution artifact.'
              : 'broker-conflict-blocked because the Broker confirmed an active task ownership conflict.';
            const requiredCommand = `node atm.mjs team broker resolve --task ${claimableTask.workItemId} --conflict ${candidate.taskId} --path ${sharedConflictSurfaces[0] ?? '<shared-path>'} --decision-reason "broker-conflict-blocked until the release order grants the next task." --json`;
            const conflictUx = buildBrokerConflictUxProjection({
              primaryTaskId: claimableTask.workItemId,
              conflictingTaskIds: [candidate.taskId],
              sharedPaths: overlappingFiles,
              overlappingAtomIds,
              decisionClass,
              decisionReason,
              violationStatus: 'broker-conflict-blocked',
              statusCode: 'broker-conflict-blocked',
              blockedTaskIds: [candidate.taskId],
              requiredCommand
            });
            // Broker verdict derivation: the parallel-preflight is itself the
            // broker-authoritative arbitration for this claim path. `blocked`
            // maps to broker `freeze`; anything else the CID gate would admit
            // maps to broker `allow`. When broker's separate authoritative
            // registry adds a distinct verdict feed here in a follow-up, the
            // divergence detector will start firing.
            const brokerVerdict = deriveBrokerVerdict({
              queuedPrivateWork: queueAdmission.status === 'queued-private-work',
              shouldBlockPerCid: effectiveShouldBlockPerCid
            });
            const admission = evaluateClaimAdmission({
              brokerVerdict,
              cidVerdict,
              candidateTaskId: claimableTask.workItemId,
              conflictingTaskId: candidate.taskId,
              overlappingAtomIds
            });
            const admissionReason = admission.admitted
              ? (queueAdmission.status === 'queued-private-work'
                ? 'broker-shared-surface-queue-private-work'
                : insufficientMutationIntent
                ? 'broker-conflict-not-confirmed'
                : claimIntent === 'closeout-only'
                ? 'closeout-only-claim-intent'
                : 'cid-overlap-without-active-write-claim')
              : null;
            const claimAdmissionDecisionLog = buildClaimAdmissionDecisionLog({
              taskId: claimableTask.workItemId,
              conflictTaskId: candidate.taskId,
              claimIntent,
              activeWriteConflict,
              confirmedBrokerConflict,
              insufficientMutationIntent,
              cidVerdict,
              brokerVerdict,
              queueAdmission,
              overlappingFiles,
              decision: admission,
              admissionReason
            });
            if (!admission.admitted) {
              throw new CliError(admission.blockCode ?? 'ATM_NEXT_CLAIM_BLOCKED', admission.blockReason
                ?? `Claim blocked due to parallel CID logic conflict with actively claimed task ${candidate.taskId} on atom(s): ${overlappingAtomIds.join(', ')}.`, {
                exitCode: 1,
                details: {
                  taskId: claimableTask.workItemId,
                  conflictWithTaskId: candidate.taskId,
                  conflictClaimActorId: conflictActorId,
                  blockedTaskIds: conflictUx.blockedTaskIds,
                  sharedPaths: conflictUx.sharedPaths,
                  overlappingAtomIds,
                  verdict: 'blocked-cid-conflict',
                  brokerVerdict,
                  cidVerdict,
                  decisionClass,
                  decisionReason,
                  violationStatus: 'broker-conflict-blocked',
                  statusCode: 'broker-conflict-blocked',
                  requiredResolutionArtifact: 'atm.brokerConflictResolution.v1',
                  requiredCommand,
                  conflictUx,
                  claimAdmissionDecisionLog,
                  admissionDivergence: admission.divergence,
                  closeoutOnlyHint: `If ${claimableTask.workItemId} already delivered its scoped files and only needs governed closeout, rerun next --claim with --claim-intent closeout-only.`
                }
              });
            }
            if (!parallelAdvisory) {
              parallelAdvisory = {
                ...finding,
                verdict: insufficientMutationIntent
                  ? 'insufficient-mutation-intent'
                  : 'parallel-safe-with-cid-overlap-advisory',
                conflictWithTaskId: candidate.taskId,
                conflictClaimActorId: conflictActorId,
                admitted: true,
                admissionReason,
                brokerVerdict,
                cidVerdict,
                claimAdmissionDecisionLog,
                ...(admission.divergence ? { admissionDivergence: admission.divergence } : {})
              };
            }
            continue;
          }
          if (overlappingAtomIds.length > 0 && !parallelAdvisory) {
            parallelAdvisory = {
              ...finding,
              verdict: finding.verdict ?? 'insufficient-mutation-intent',
              conflictWithTaskId: candidate.taskId,
              admitted: true,
              admissionReason: 'broker-conflict-not-confirmed'
            };
            continue;
          }
          if (finding.verdict !== 'parallel-safe' && !parallelAdvisory) {
            parallelAdvisory = finding;
          }
        }
      }
    }
  } catch (err) {
    if (err instanceof CliError && err.code === 'ATM_NEXT_CLAIM_BLOCKED') {
      throw err;
    }
    // Other parallel errors are handled as best-effort
  }
  claimLatencyPhases.push({ phase: 'parallel-preflight', durationMs: Date.now() - parallelStartedAt });
  const claimDeliveryClassification = classifyTaskDelivery({
    cwd: input.cwd,
    task: {
      workItemId: claimableTask.workItemId,
      status: claimableTask.status,
      targetRepo: claimableTask.targetRepo,
      closureAuthority: claimableTask.closureAuthority,
      planningRepo: claimableTask.planningRepo,
      sourcePlanPath: claimableTask.sourcePlanPath,
      taskPath: claimableTask.taskPath
    }
  });
  if (claimDeliveryClassification.intent === 'mirror-sync-only') {
    const sourcePath = claimableTask.sourcePlanPath ?? '<source-task-card-path>';
    const requiredCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --write --force --json`;
    throw new CliError('ATM_NEXT_CLAIM_MIRROR_SYNC_REQUIRED', `Task ${claimableTask.workItemId} is a planning-only mirror in this repo; sync the ledger from the source task card instead of claiming a delivery.`, {
      exitCode: 1,
      details: {
        taskId: claimableTask.workItemId,
        targetRepo: claimDeliveryClassification.targetRepo,
        closureAuthority: claimDeliveryClassification.closureAuthority,
        planningRepo: claimDeliveryClassification.planningRepo,
        sourceStatus: claimDeliveryClassification.sourceStatus,
        ledgerStatus: claimDeliveryClassification.ledgerStatus,
        statusDivergence: claimDeliveryClassification.statusDivergence,
        requiredCommand,
        deliveryClassification: claimDeliveryClassification
      }
    });
  }
  const scopeDiagnostic = checkPendingTaskArtifactScopeExpansion({
    cwd: input.cwd,
    task: claimableTask
  });
  const brokerClaimCheck = inspectBrokerClaimLifecycle({
    cwd: input.cwd,
    taskId: claimableTask.workItemId,
    actorId: resolvedActor.actorId
  });
  if (!brokerClaimCheck.ok) {
    throw new CliError('ATM_BROKER_LIFECYCLE_BLOCKED', brokerClaimCheck.reason ?? `Task ${claimableTask.workItemId} cannot claim because broker runtime state is blocked.`, {
      exitCode: 1,
      details: {
        taskId: claimableTask.workItemId,
        actorId: resolvedActor.actorId,
        registryPath: brokerClaimCheck.registryPath,
        blockingIntent: brokerClaimCheck.blockingIntent
      }
    });
  }
  const alreadyClaimedByActor = existingClaimActorId === resolvedActor.actorId;
  const activeClaimIntent = claimableTask.activeClaimIntent ?? 'write';
  const shouldReuseActiveClaim = alreadyClaimedByActor
    && (autoIntent || activeClaimIntent === claimIntent);
  let preClaimBrokerTransaction: Record<string, unknown> | undefined = undefined;
  if (!shouldReuseActiveClaim) {
    const transaction = await registerPreClaimBrokerTransaction({
      cwd: input.cwd,
      taskId: claimableTask.workItemId,
      actorId: resolvedActor.actorId,
      targetFiles: claimAllowedFiles
    });
    preClaimBrokerTransaction = transaction;
    const queueAdmission = transaction.queueAdmission as BrokerQueueAdmission;
    if (queueAdmission.status === 'queued-blocked') {
      await runBroker(['release', '--cwd', input.cwd, '--task', claimableTask.workItemId]);
      throw new CliError('ATM_NEXT_CLAIM_BLOCKED', `broker-conflict-blocked: ${queueAdmission.reason}`, {
        exitCode: 1,
        details: { taskId: claimableTask.workItemId, brokerQueueAdmission: queueAdmission }
      });
    }
    if (queueAdmission.status === 'queued-private-work') {
      brokerQueueAdmission = queueAdmission;
      claimAllowedFiles = queueAdmission.allowedFiles;
    }
  }
  const claimPreparationStartedAt = Date.now();
  const claimPreparation = shouldReuseActiveClaim
    ? {
      taskId: claimableTask.workItemId,
      originalStatus: normalizeTaskRouteStatus(claimableTask.status),
      steps: [],
      reusedActiveClaim: true
    }
    : await prepareImportedTaskForClaim({
      cwd: input.cwd,
      task: claimableTask,
      actorId: resolvedActor.actorId
    });
  claimLatencyPhases.push({ phase: 'claim-preparation', durationMs: Date.now() - claimPreparationStartedAt });
  const claimCommandStartedAt = Date.now();
  const claimResult = shouldReuseActiveClaim
    ? await runTasks([
      'renew',
      '--cwd',
      input.cwd,
      '--task',
      claimableTask.workItemId,
      '--actor',
      resolvedActor.actorId,
      '--json'
    ])
    : await runTasks([
      'claim',
      '--cwd',
      input.cwd,
      '--task',
      claimableTask.workItemId,
      '--actor',
      resolvedActor.actorId,
      ...(autoIntent ? ['--auto-intent'] : ['--claim-intent', claimIntent]),
      '--files',
      Array.from(new Set([
        claimableTask.taskPath,
        ...claimAllowedFiles
      ])).join(','),
      '--json'
    ]);
  claimLatencyPhases.push({ phase: shouldReuseActiveClaim ? 'renew-claim' : 'tasks-claim', durationMs: Date.now() - claimCommandStartedAt });
  if (shouldReuseActiveClaim && claimResult.ok && claimResult.evidence) {
    const evidence = claimResult.evidence as Record<string, unknown> & { reusedActiveClaim?: boolean; claimIntent?: string | null };
    evidence.reusedActiveClaim = true;
    evidence.claimIntent = activeClaimIntent;
  }
  const activeQueue = importedTaskQueue.promptScope?.status === 'queue'
    ? promptScopeRuntime?.queue ?? findActiveTaskQueueForIntent(input.cwd, input.taskIntent, { taskId: claimableTask.workItemId }) ?? createOrRefreshTaskQueue({
      cwd: input.cwd,
      sourcePrompt: input.taskIntent?.userPrompt ?? claimableTask.workItemId,
      tasks: importedTaskQueue.promptScope.selectedTasks,
      taskIds: importedTaskQueue.promptScope.selectedTasks.map((task) => task.workItemId),
      actorId: resolvedActor.actorId
    })
    : findActiveTaskQueue(input.cwd, input.taskIntent?.userPrompt ?? claimableTask.workItemId);
  const inheritedBatchRun = readActiveBatchRun(input.cwd, { taskId: claimableTask.workItemId });
  const batchRun = importedTaskQueue.promptScope?.status === 'queue'
    ? activeBatchAtClaimStart?.status === 'active' && activeBatchAtClaimStart.taskIds.includes(claimableTask.workItemId)
      ? activeBatchAtClaimStart
      : writeBatchRun({
        cwd: input.cwd,
        sourcePrompt: input.taskIntent?.userPrompt ?? claimableTask.workItemId,
        tasks: importedTaskQueue.promptScope.selectedTasks,
        queue: activeQueue,
        actorId: resolvedActor.actorId
      })
    : inheritedBatchRun?.status === 'active' && inheritedBatchRun.taskIds.includes(claimableTask.workItemId)
      ? inheritedBatchRun
      : null;
  const queueForDirection = batchRun && activeQueue
    ? createOrRefreshTaskQueue({
      cwd: input.cwd,
      sourcePrompt: activeQueue.sourcePrompt,
      tasks: activeQueue.tasks,
      taskIds: activeQueue.taskIds,
      actorId: resolvedActor.actorId,
      batchId: batchRun.batchId,
      scopeKey: batchRun.scopeKey
    })
    : activeQueue;
  if (batchRun && queueForDirection) {
    await cleanupPreviousBatchQueueLocks({
      cwd: input.cwd,
      actorId: resolvedActor.actorId,
      queue: queueForDirection
    });
  }
  const directionLockStartedAt = Date.now();
  const directionLock = writeTaskDirectionLock({
    cwd: input.cwd,
    taskId: claimableTask.workItemId,
    actorId: resolvedActor.actorId,
    queue: queueForDirection,
    batchId: batchRun?.batchId ?? null,
    scopeKey: batchRun?.scopeKey ?? null,
    allowedFiles: claimAllowedFiles,
    planningReadOnlyPaths: claimableTask.planningReadOnlyPaths,
    planningMirrorPaths: claimableTask.planningMirrorPaths,
    allowPlanningMirror: claimableTask.allowPlanningMirror,
    prompt: input.taskIntent?.userPrompt ?? claimableTask.workItemId
  });
  claimLatencyPhases.push({ phase: 'direction-lock-write', durationMs: Date.now() - directionLockStartedAt });
  const claimEvidence = claimResult && typeof claimResult === 'object' && 'evidence' in claimResult && claimResult.evidence && typeof claimResult.evidence === 'object'
    ? claimResult.evidence as Record<string, unknown>
    : null;
  const resolvedClaimIntent = typeof claimEvidence?.claimIntent === 'string'
    ? claimEvidence.claimIntent
    : claimIntent;
  const claimRecord = claimEvidence && typeof claimEvidence.claim === 'object' && claimEvidence.claim
    ? claimEvidence.claim as Record<string, unknown>
    : null;
  const claimedSessionId = typeof claimEvidence?.sessionId === 'string' ? claimEvidence.sessionId : null;
  const actorSession = upsertActorWorkSession({
    cwd: input.cwd,
    sessionId: claimedSessionId,
    actorId: resolvedActor.actorId,
    taskId: claimableTask.workItemId,
    claimLeaseId: typeof claimRecord?.leaseId === 'string'
      ? claimRecord.leaseId
      : resolveActorWorkSession(input.cwd, {
        actorId: resolvedActor.actorId,
        taskId: claimableTask.workItemId,
        includeNonActive: true
      })?.claimLeaseId ?? null,
    status: 'active',
    taskPath: claimableTask.taskPath,
    sourcePrompt: batchRun?.sourcePrompt ?? input.taskIntent?.userPrompt ?? claimableTask.workItemId,
    batchId: batchRun?.batchId ?? null,
    guidanceSessionId: null
  }).session;
  const recommendedChannel = selectPostClaimChannel(batchRun?.status === 'active').recommendedChannel;
  if (shouldReuseActiveClaim) {
    recordBrokerClaimIntent({
      cwd: input.cwd,
      taskId: claimableTask.workItemId,
      actorId: resolvedActor.actorId,
      lane: recommendedChannel === 'batch' ? 'serial' : 'direct-brokered',
      targetFiles: directionLock.allowedFiles,
      ttlSeconds: 1800
    });
  }
  const nextActionBase: NextActionLike = {
    status: 'ready',
    command: `node atm.mjs start --cwd . --goal ${quoteCliValue(claimableTask.title)} --json`,
    reason: `claimed imported work item ${claimableTask.workItemId} for ${resolvedActor.actorId}`,
    recommendedChannel,
    claimIntent: resolvedClaimIntent,
    riskLevel: recommendedChannel === 'batch' ? 'high' : 'medium',
    playbook: buildChannelPlaybook({
      channel: recommendedChannel as any,
      taskId: claimableTask.workItemId,
      queueHeadTaskId: batchRun?.currentTaskId ?? claimableTask.workItemId,
      originalPrompt: batchRun?.sourcePrompt ?? input.taskIntent?.userPrompt ?? claimableTask.workItemId,
      actorPlaceholder: resolvedActor.actorId
    }),
    deliveryPrinciple: buildTaskDeliveryPrinciple({
      channel: recommendedChannel === 'batch' ? 'batch' : 'normal',
      taskId: claimableTask.workItemId
    }),
    selectedTask: claimableTask,
    batchId: batchRun?.batchId ?? null,
    scopeKey: batchRun?.scopeKey ?? null,
    planningContext: {
      readOnlyPaths: claimableTask.planningReadOnlyPaths,
      sourcePlanPath: claimableTask.sourcePlanPath,
      nearbyPlanPaths: claimableTask.nearbyPlanPaths
    },
    targetWork: {
      allowedFiles: claimableTask.targetAllowedFiles,
      targetRepo: claimableTask.targetRepo,
      allowPlanningMirror: claimableTask.allowPlanningMirror
    },
    taskContext: {
      planningContext: {
        readOnlyPaths: claimableTask.planningReadOnlyPaths,
        sourcePlanPath: claimableTask.sourcePlanPath,
        nearbyPlanPaths: claimableTask.nearbyPlanPaths
      },
      targetWork: {
        allowedFiles: claimableTask.targetAllowedFiles,
        targetRepo: claimableTask.targetRepo,
        allowPlanningMirror: claimableTask.allowPlanningMirror
      },
      scopePaths: claimableTask.scopePaths,
      sourcePlanPath: claimableTask.sourcePlanPath
    },
    taskDirectionLock: directionLock,
    ...(brokerQueueAdmission ? { brokerQueueAdmission } : {}),
    taskQueue: activeQueue,
    batchRun,
    sessionId: actorSession.sessionId,
    actorSession,
    scopeDiagnostic,
    ignoredUntrackedFiles: scopeDiagnostic.ignoredUntrackedFiles,
    allowedCommands: allowedGuidanceBootstrapCommands(),
    blockedCommands: blockedMutationCommands()
  };
  const nextAction = embedTeamRecommendation(nextActionBase, {
    taskId: claimableTask.workItemId,
    actorId: resolvedActor.actorId,
    channel: recommendedChannel as any,
    reason: recommendedChannel === 'batch'
      ? 'Batch queue-head work can use a current-task team, but ATM still owns checkpoint and advance.'
      : 'This task can use an optional team run for role/permission coordination.',
    knowledgeSummary: buildTeamKnowledgeSummary({
      cwd: input.cwd,
      taskId: claimableTask.workItemId,
      top: 3
    }),
    parallelAdvisory
  });
  const userNotice = buildFirstUseUserNotice(nextAction);
  return makeResult({
    ok: true,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction,
      userNotice,
      input.integrationBootstrap,
      input.runtimeAdapterReadiness,
      message('info', 'ATM_NEXT_CLAIMED', 'Claimed the next imported work item.', {
        taskId: claimableTask.workItemId,
        actorId: resolvedActor.actorId,
        actorSource: resolvedActor.source,
        actorResolution,
        recommendedChannel: nextAction.recommendedChannel,
        claimIntent: resolvedClaimIntent,
        batchCheckpointCommand: nextAction.recommendedChannel === 'batch'
          ? 'node atm.mjs batch checkpoint --actor <id> --json'
          : null,
        blockedPattern: nextAction.recommendedChannel === 'batch'
          ? 'manual tasks claim/close loop'
          : null,
        ignoredUntrackedFiles: scopeDiagnostic.ignoredUntrackedFiles,
        ignoredUntrackedNote: scopeDiagnostic.ignoredUntrackedFiles.length > 0
          ? 'These files are NOT blocking the claim. If any of them is actually a deliverable for this task, run `node atm.mjs tasks scope --add <paths>` to widen the scope and then `git add` them.'
          : null
      })
    ),
    evidence: {
      nextAction,
      actorResolution,
      claimIntent: resolvedClaimIntent,
      claimPreparation,
      claimResult: claimResult.evidence,
      ...(preClaimBrokerTransaction ? { preClaimBrokerTransaction } : {}),
      taskDirectionLock: directionLock,
      taskQueue: activeQueue,
      batchRun,
      teamRecommendation: nextAction.teamRecommendation ?? null,
      sessionId: actorSession.sessionId,
      actorSession,
      recommendedChannel: nextAction.recommendedChannel,
      taskIntent: input.taskIntent,
      importedTaskQueue: input.importedTaskQueue,
      integrationBootstrap: input.integrationBootstrap,
      runtimeAdapterReadiness: input.runtimeAdapterReadiness,
      claimLatency: {
        schemaId: 'atm.claimLatencyTelemetry.v1',
        totalMs: Date.now() - claimStartedAt,
        phases: claimLatencyPhases
      }
    }
  });
}

async function cleanupPreviousBatchQueueLocks(input: {
  readonly cwd: string;
  readonly actorId: string;
  readonly queue: TaskQueueRecord;
}) {
  const previousTaskIds = input.queue.taskIds.slice(0, Math.max(0, input.queue.currentIndex));
  for (const taskId of previousTaskIds) {
    try {
      await runTasks([
        'lock',
        'cleanup',
        '--cwd',
        input.cwd,
        '--task',
        taskId,
        '--actor',
        input.actorId,
        '--reason',
        'batch queue stale lock auto cleanup',
        '--json'
      ]);
    } catch {
      // The cleanup command already refuses active/non-stale locks; this is best-effort only.
    }
  }
}


function buildPromptGuidanceNextResult(input: {
  readonly cwd: string;
  readonly actor?: string;
  readonly taskIntent: TaskIntent | null;
  readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
  readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}) {
  const prompt = input.taskIntent?.userPrompt?.trim();
  if (!prompt || input.taskIntent?.taskScopeMentioned === true) return null;
  const quickfixScope = resolveQuickfixScope(prompt);
  if (isQuickfixPrompt(prompt) && quickfixScope.length > 0) {
    const nextAction: NextActionLike = {
      status: 'quickfix-ready',
      command: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(prompt)} --json`,
      reason: 'the prompt looks like a small targeted fix with path-like scope, so ATM can use the fast quickfix channel',
      recommendedChannel: 'fast',
      riskLevel: 'low',
      playbook: buildChannelPlaybook({
        channel: 'fast',
        originalPrompt: prompt
      }),
      governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
        channel: 'fast',
        prompt,
        actorId: input.actor,
        ownFiles: quickfixScope
      }),
      allowedFiles: quickfixScope,
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
    return makeResult({
      ok: true,
      command: 'next',
      cwd: input.cwd,
      messages: buildNextMessages(
        nextAction,
        null,
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
        message('info', 'ATM_NEXT_QUICKFIX_ROUTE_READY', 'ATM routed this prompt to the fast quickfix channel.', {
          requiredCommand: nextAction.command,
          allowedFiles: quickfixScope
        })
      ),
      evidence: {
        nextAction,
        recommendedChannel: 'fast',
        taskIntent: input.taskIntent,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  const frameworkStatus = createFrameworkModeStatus({ cwd: input.cwd });
  if (frameworkStatus.repoIdentity.isFrameworkRepo && isFrameworkMaintenancePrompt(prompt)) {
    const claimCommand = buildFrameworkTempClaimCommand([], prompt);
    const nextAction: NextActionLike = {
      status: 'framework-temp-claim-required',
      command: claimCommand,
      reason: 'the prompt appears to be ATM framework maintenance without a human task card, so use a temporary runtime claim before editing critical framework files',
      recommendedChannel: 'fast',
      riskLevel: 'high',
      playbook: buildChannelPlaybook({
        channel: 'fast',
        originalPrompt: prompt,
        fastClaimCommand: claimCommand,
        fastClaimLabel: 'framework temp claim'
      }),
      governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
        channel: 'fast',
        prompt,
        actorId: input.actor,
        frameworkClaimRequired: true
      }),
      allowedCommands: [
        claimCommand,
        'node atm.mjs framework-mode status --json',
        'node atm.mjs guard framework-development --json'
      ],
      blockedCommands: [
        'editing framework critical files before framework-mode claim',
        'creating AI-authored permanent task cards in .atm/history/tasks'
      ]
    };
    return makeResult({
      ok: true,
      command: 'next',
      cwd: input.cwd,
      messages: buildNextMessages(
        nextAction,
        null,
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
        message('info', 'ATM_NEXT_FRAMEWORK_TEMP_CLAIM_REQUIRED', 'ATM detected framework maintenance without a scoped task; acquire a temporary framework runtime claim before editing.', {
          requiredCommand: claimCommand
        })
      ),
      evidence: {
        nextAction,
        recommendedChannel: 'fast',
        agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
        taskIntent: input.taskIntent,
        frameworkStatus,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  const nextAction: NextActionLike = {
    status: 'prompt-guidance-required',
    command: `node atm.mjs guide --goal ${quoteCliValue(prompt)} --cwd . --json`,
    reason: 'the user supplied a prompt that is not task-scoped, so ATM routes guidance from that prompt instead of reusing stale global guidance',
    recommendedChannel: null,
    riskLevel: 'medium',
    governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
      channel: null,
      prompt,
      actorId: input.actor
    }),
    allowedCommands: allowedGuidanceBootstrapCommands(),
    blockedCommands: blockedMutationCommands(),
    ...buildNonPlaybookRouteHints(input.cwd, prompt)
  };
  const userNotice = buildFirstUseUserNotice(nextAction);
  return makeResult({
    ok: true,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction,
      userNotice,
      input.integrationBootstrap,
      input.runtimeAdapterReadiness,
      message('info', 'ATM_NEXT_PROMPT_GUIDANCE_REQUIRED', 'ATM routed next-action guidance from the current prompt instead of stale global state.', {
        command: nextAction.command
      })
    ),
    evidence: {
      nextAction,
      agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
      ...(userNotice ? { userNotice } : {}),
      taskIntent: input.taskIntent,
      integrationBootstrap: input.integrationBootstrap,
      runtimeAdapterReadiness: input.runtimeAdapterReadiness
    }
  });
}

function buildPromptRequiredNextResult(input: {
  readonly cwd: string;
  readonly claimRequested: boolean;
  readonly importedTaskQueue: ImportedTaskQueue;
  readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
  readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}) {
  const candidatePreview = input.importedTaskQueue.tasks.slice(0, 12).map(toTaskCandidateView);
  const nextAction: NextActionLike = {
    status: 'prompt-required',
    command: 'node atm.mjs next --prompt "<current user prompt>" --json',
    reason: 'task cards exist, but no current user prompt was provided; ATM will not choose a global task or batch by accident',
    recommendedChannel: null,
    riskLevel: 'medium',
    candidateCount: input.importedTaskQueue.tasks.length,
    candidates: candidatePreview,
    batchInstruction: 'If the user asked for all task cards, a whole plan, or multiple tasks, rerun with the original prompt so ATM can return recommendedChannel=batch and require batch checkpoint.',
    allowedCommands: [
      'node atm.mjs next --prompt "<current user prompt>" --json',
      'node atm.mjs next --claim --actor <id> --prompt "<current user prompt>" --auto-intent --json'
    ],
    blockedCommands: [
      'manual tasks claim/close loops without prompt-scoped next',
      'batch task closure without node atm.mjs batch checkpoint --actor <id> --json'
    ]
  };
  return makeResult({
    ok: false,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction,
      null,
      input.integrationBootstrap,
      input.runtimeAdapterReadiness,
      message(
        'error',
        input.claimRequested ? 'ATM_NEXT_CLAIM_PROMPT_REQUIRED' : 'ATM_NEXT_PROMPT_REQUIRED_FOR_TASK_ROUTING',
        'ATM found task cards, but no user prompt was provided. Rerun next with the current user prompt so ATM can choose fast, normal, or batch correctly.',
        {
          requiredCommand: nextAction.command,
          candidateCount: nextAction.candidateCount,
          batchInstruction: nextAction.batchInstruction
        }
      )
    ),
    evidence: {
      nextAction,
      importedTaskQueue: input.importedTaskQueue,
      integrationBootstrap: input.integrationBootstrap,
      runtimeAdapterReadiness: input.runtimeAdapterReadiness
    }
  });
}

async function prepareImportedTaskForClaim(input: {
  readonly cwd: string;
  readonly task: ImportedTaskSummary;
  readonly actorId: string;
}) {
  const normalizedStatus = normalizeTaskRouteStatus(input.task.status);
  const prepared = prepareTaskForClaim({
    cwd: input.cwd,
    taskId: input.task.workItemId,
    actorId: input.actorId,
    status: input.task.status,
    title: input.task.title,
    transitionCommand: `node atm.mjs next --claim --task ${input.task.workItemId} --actor ${input.actorId} --auto-intent --json`
  });
  return {
    taskId: input.task.workItemId,
    originalStatus: normalizedStatus,
    steps: prepared.steps.map((step) => ({
      action: step.action,
      evidence: {
        action: step.action,
        taskId: input.task.workItemId,
        actorId: input.actorId,
        status: step.status,
        transitionPath: step.transitionPath,
        importEvidencePath: step.importEvidencePath ?? null
      }
    }))
  };
}

async function registerPreClaimBrokerTransaction(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly targetFiles: readonly string[];
}): Promise<Record<string, unknown>> {
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: input.cwd, encoding: 'utf8' });
  const baseCommit = head.status === 0 ? head.stdout.trim() : '';
  if (!baseCommit) {
    throw new CliError('ATM_BROKER_TRANSACTION_BASE_MISSING', 'next --claim requires a resolvable HEAD before registering its Broker transaction.', { exitCode: 1 });
  }
  const intent = {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'next pre-claim Broker transaction' },
    taskId: input.taskId,
    actorId: input.actorId,
    baseCommit,
    targetFiles: input.targetFiles,
    atomRefs: [],
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
    requestedLane: 'auto'
  } as const;
  const intentPath = path.join(input.cwd, '.atm', 'runtime', 'broker-intents', `${input.taskId}.json`);
  mkdirSync(path.dirname(intentPath), { recursive: true });
  writeFileSync(intentPath, `${JSON.stringify(intent, null, 2)}\n`, 'utf8');
  const result = await runBroker([
    'register', '--cwd', input.cwd, '--task', input.taskId, '--actor', input.actorId, '--intent-file', intentPath
  ]);
  const evidence = result && typeof result === 'object' && 'evidence' in result
    ? (result.evidence as Record<string, unknown>)
    : null;
  const queueAdmission = evidence?.queueAdmission;
  if (!queueAdmission || typeof queueAdmission !== 'object' || !('status' in queueAdmission)) {
    throw new CliError('ATM_BROKER_TRANSACTION_INVALID', 'Broker pre-claim registration returned no canonical queue admission.', { exitCode: 1 });
  }
  return {
    intentPath: path.relative(input.cwd, intentPath).replace(/\\/g, '/'),
    baseCommit,
    queueAdmission,
    brokerDecision: evidence.decision ?? null
  };
}

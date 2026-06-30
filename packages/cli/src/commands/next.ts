import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs';
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
  decisionResultForStatus,
  tokenizeForMatch,
  countTokenOverlap,
  type NextDecisionTrailEntry
} from './next/match-and-sort.ts';
import { runDoctor } from './doctor.ts';
import { bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.ts';
import { describeIntegrationInstallHint, inspectIntegrationBootstrap } from './integration.ts';
import { inspectRuntimeAdapterReadiness } from './runtime-adapter-readiness.ts';
import { resolveActorId } from './actor-registry.ts';
import { resolveActorWorkSession, upsertActorWorkSession } from './actor-session.ts';
import { buildFrameworkTempClaimCommand, createFrameworkModeStatus } from './framework-development.ts';
import { describeBuildReleaseHygienePolicy } from '../../../../scripts/build-release-hygiene.ts';
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
import { buildTeamRecommendation, type TeamRecommendation } from './team.ts';
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
  resolveCandidatePlanningRoots,
  type PlanningRootWarning
} from './next/planning-root-preference.ts';

export async function runNext(argv: string[]) {
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
  const integrationBootstrap = inspectIntegrationBootstrap(options.cwd);
  const runtimeAdapterReadiness = inspectRuntimeAdapterReadiness(options.cwd);
  const explicitTaskIds = uniqueInOrder([
    ...(typeof options.task === 'string' && options.task.trim().length > 0 ? [options.task] : []),
    ...(Array.isArray(options.tasks) ? options.tasks : [])
  ]);
  const taskIntent = resolveTaskIntent(options.cwd, {
    prompt: options.prompt,
    intentPath: options.intent,
    explicitTaskIds
  });
  const importedTaskQueue = inspectImportedTaskQueue(options.cwd, taskIntent, claimIntent ?? 'write');
  const scopedTargetRepo = importedTaskQueue.promptScope?.targetRepo ?? null;
  const earlyFrameworkStatus = createFrameworkModeStatus({
    cwd: options.cwd,
    targetRepo: scopedTargetRepo
  });
  if (earlyFrameworkStatus.mode === 'cross-repo-target-required') {
    return withRunnerMode(buildCrossRepoFrameworkNextResult({
      cwd: options.cwd,
      frameworkStatus: earlyFrameworkStatus,
      integrationBootstrap,
      runtimeAdapterReadiness,
      importedTaskQueue
    }), options.cwd);
  }
  if (!taskIntent && hasPromptScopedWorkItems(importedTaskQueue)) {
    return withRunnerMode(buildPromptRequiredNextResult({
      cwd: options.cwd,
      claimRequested: Boolean(options.claim),
      importedTaskQueue,
      integrationBootstrap,
      runtimeAdapterReadiness
    }), options.cwd);
  }
  if (options.claim) {
    return withRunnerMode(await claimNextImportedTask({
      cwd: options.cwd,
      actor: options.agent,
      claimIntent,
      autoIntent,
      taskIntent,
      importedTaskQueue,
      integrationBootstrap,
      runtimeAdapterReadiness
    }), options.cwd);
  }
  const promptScopeResult = buildPromptScopedNextResult({
    cwd: options.cwd,
    taskIntent,
    importedTaskQueue,
    integrationBootstrap,
    runtimeAdapterReadiness
  });
  if (promptScopeResult) {
    return withRunnerMode(promptScopeResult, options.cwd);
  }
  const promptGuidanceResult = buildPromptGuidanceNextResult({
    cwd: options.cwd,
    taskIntent,
    integrationBootstrap,
    runtimeAdapterReadiness
  });
  if (promptGuidanceResult) {
    return withRunnerMode(promptGuidanceResult, options.cwd);
  }
  const activeGuidanceSession = readActiveGuidanceSession(options.cwd);
  if (activeGuidanceSession) {
    const baseAction = toGuidanceNextAction(activeGuidanceSession.packet, activeGuidanceSession.routeDecision.blockedBy);
    const legacyPlan = activeGuidanceSession.legacyRoutePlan ?? null;
    const nextAction = legacyPlan ? enrichWithLegacyPlan(options.cwd, baseAction, legacyPlan, activeGuidanceSession.sessionId) : baseAction;
    const userNotice = buildFirstUseUserNotice(nextAction);
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
  const runtime = detectGovernanceRuntime(options.cwd, bootstrapTaskId);
  const doctorChecks = doctor.evidence.checks as Array<{ name: string; ok: boolean }>;
  const failed = doctorChecks.find((check) => check.ok !== true);
  const nextAction = decideNextAction(runtime, failed?.name ?? null, importedTaskQueue);
  const userNotice = buildFirstUseUserNotice(nextAction);
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

function withRunnerMode<T extends { evidence?: Record<string, unknown>; messages?: unknown[] }>(result: T, cwd: string): T {
  const runnerMode = describeRunnerMode(cwd);
  if (result.evidence && typeof result.evidence === 'object') {
    result.evidence.runnerMode = runnerMode;
    if (result.evidence.nextAction && typeof result.evidence.nextAction === 'object' && !Array.isArray(result.evidence.nextAction)) {
      result.evidence.nextAction.runnerMode = runnerMode;
    }
  }
  const planningRootWarnings = result.evidence?.importedTaskQueue?.planningRootWarnings as readonly PlanningRootWarning[] | undefined;
  if (Array.isArray(planningRootWarnings) && Array.isArray(result.messages)) {
    for (const warning of planningRootWarnings) {
      if (result.messages.some((entry) => entry?.code === warning.code && entry?.data?.siblingRepoDirs?.join(',') === warning.siblingRepoDirs.join(','))) {
        continue;
      }
      result.messages.unshift(message('warning', warning.code, warning.detail, {
        siblingRepoDirs: warning.siblingRepoDirs
      }));
    }
  }
  if (Array.isArray(result.messages) && !result.messages.some((entry) => entry?.code === 'ATM_RUNNER_MODE')) {
    result.messages.push(message('info', 'ATM_RUNNER_MODE', `ATM next is running in ${runnerMode.mode} mode.`, runnerMode));
  }
  return result;
}

function describeRunnerMode(cwd: string) {
  const releaseHygienePolicy = describeBuildReleaseHygienePolicy();
  const root = path.resolve(cwd);
  const entrypointPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
  const entrypoint = entrypointPath ? normalizeRelativePath(root, entrypointPath) : null;
  const mode = classifyRunnerMode(entrypoint);
  return {
    schemaId: 'atm.runnerMode.v1',
    mode,
    entrypoint,
    normalGovernanceCommand: 'node atm.mjs ...',
    sourceFirstCommand: 'node atm.dev.mjs ...',
    sourceFirstOnlyWhen: 'explicit source-first framework validation is requested for unbuilt source changes',
    syncCommand: releaseHygienePolicy.runnerSyncCommand,
    frozenRunnerSources: [
      'release/atm-onefile/atm.mjs',
      'packages/cli/dist/atm.js'
    ],
    guidance: mode === 'source-first' || mode === 'source-import'
      ? `Use this only for explicit source-first framework validation. Run ${releaseHygienePolicy.runnerSyncCommand} before release-like validation through node atm.mjs.`
      : `Use node atm.mjs for normal governance routing. If ATM_RUNNER_SYNC_REQUIRED appears, run ${releaseHygienePolicy.runnerSyncCommand} and rerun the frozen entrypoint.`
  };
}

function classifyRunnerMode(entrypoint: string | null) {
  if (!entrypoint) return 'unknown';
  const normalized = entrypoint.replace(/\\/g, '/');
  if (normalized === 'atm.dev.mjs') return 'source-first';
  if (normalized === 'atm.mjs'
    || normalized === 'release/atm-onefile/atm.mjs'
    || normalized === 'packages/cli/dist/atm.js'
    || normalized === 'release/atm-root-drop/atm.mjs'
    || normalized.includes('/atm-onefile-cache/')) {
    return 'frozen';
  }
  if (normalized.startsWith('scripts/') || normalized.includes('/scripts/') || normalized.includes('/packages/cli/src/')) return 'source-import';
  return 'unknown';
}

function normalizeRelativePath(root: string, entryPath: string) {
  const relative = path.relative(root, entryPath).replace(/\\/g, '/');
  return relative && !relative.startsWith('..') ? relative : entryPath.replace(/\\/g, '/');
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

function decideNextAction(runtime: Record<string, unknown>, failedCheckName: string | null | undefined, importedTaskQueue: ImportedTaskQueue) {
  if (runtime.migrationNeeded || runtime.hasV1 && runtime.hasV2 === false) {
    return {
      status: 'needs-bootstrap',
      command: 'node atm.mjs bootstrap --cwd . --force --task "Bootstrap ATM in this repository"',
      reason: 'legacy layout needs migration to runtime/history/catalog',
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  if (failedCheckName === 'onboarding-lifecycle') {
    return {
      status: 'needs-onboarding-refresh',
      command: 'node atm.mjs atm-chart render --cwd . --json',
      reason: 'onboarding ATMChart sources are missing or stale',
      afterNextAction: 'After this onboarding refresh succeeds, return to the user original request and continue the actual work.',
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  if (!runtime.config) {
    return {
      status: 'needs-bootstrap',
      command: 'node atm.mjs bootstrap --cwd . --task "Bootstrap ATM in this repository"',
      reason: '.atm/config.json is missing',
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  if (!runtime.currentTaskId) {
    if (importedTaskQueue.selectedTask) {
      return {
        status: 'ready',
        command: `node atm.mjs start --cwd . --goal ${quoteCliValue(importedTaskQueue.selectedTask.title)} --json`,
        reason: `imported work item ${importedTaskQueue.selectedTask.workItemId} is ready to start`,
        selectedTask: importedTaskQueue.selectedTask,
        allowedCommands: allowedGuidanceBootstrapCommands(),
        blockedCommands: blockedMutationCommands()
      };
    }
    return {
      status: 'needs-guidance-start',
      command: 'node atm.mjs orient --cwd . --json',
      reason: 'no active guidance session is recorded',
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  if (!runtime.lastEvidenceAt) {
    return {
      status: 'needs-evidence',
      command: `node atm.mjs handoff summarize --task ${runtime.currentTaskId} --json`,
      reason: 'the current governed task does not have recorded evidence yet',
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  if (!runtime.lastHandoffAt) {
    return {
      status: 'needs-handoff',
      command: `node atm.mjs handoff summarize --task ${runtime.currentTaskId} --json`,
      reason: 'the current governed task does not have a handoff summary yet',
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  if (failedCheckName) {
    return {
      status: 'needs-validation',
      command: 'npm run validate:full',
      reason: `doctor reported a failing check: ${failedCheckName}`,
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
  }
  return {
    status: 'ready',
    command: 'npm test',
    reason: 'runtime state, governance state, and engineering checks are all green',
    allowedCommands: allowedGuidanceBootstrapCommands(),
    blockedCommands: blockedMutationCommands()
  };
}

function buildCrossRepoFrameworkNextResult(input: {
  readonly cwd: string;
  readonly frameworkStatus: ReturnType<typeof createFrameworkModeStatus>;
  readonly integrationBootstrap: unknown;
  readonly runtimeAdapterReadiness: unknown;
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
  const userNotice = buildFirstUseUserNotice(nextAction as Record<string, unknown>);
  return makeResult({
    ok: false,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction as Record<string, unknown>,
      userNotice,
      input.integrationBootstrap as Record<string, unknown>,
      input.runtimeAdapterReadiness as Record<string, unknown>,
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
  readonly taskIntent: TaskIntent | null;
  readonly importedTaskQueue: ImportedTaskQueue;
  readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
  readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}) {
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
    const nextAction = {
      status: 'ready',
      command: 'Apply the quickfix within the allowed files and commit normally.',
      reason: `claimed ATM quickfix lock for ${resolvedActor.actorId}`,
      recommendedChannel: 'fast',
      riskLevel: 'low',
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
        nextAction as any,
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
  const resolvedActor = resolveActorId(input.actor ?? undefined, input.cwd);
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
        actorId: existingClaimActorId
      }
    });
  }
  let parallelAdvisory: any = undefined;
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
          if (finding.verdict === 'blocked-cid-conflict') {
            // TASK-CID-0024: same-file / same-atom overlap only blocks the
            // claim when the overlapping task is actively write-claimed by
            // another actor. Queued-but-idle overlaps and closeout-only
            // counterparts are admitted with an advisory so same-file
            // CID-disjoint parallel work stops being serialized by default.
            const conflictActorId = typeof candidate.activeClaimActorId === 'string' && candidate.activeClaimActorId.trim().length > 0
              ? candidate.activeClaimActorId
              : null;
            const conflictIntent = typeof candidate.activeClaimIntent === 'string' ? candidate.activeClaimIntent : null;
            const activeWriteConflict = Boolean(conflictActorId)
              && conflictActorId !== resolvedActor.actorId
              && conflictIntent !== 'closeout-only';
            if (claimIntent !== 'closeout-only' && activeWriteConflict) {
              throw new CliError('ATM_NEXT_CLAIM_BLOCKED', `Claim blocked due to parallel CID logic conflict with actively claimed task ${candidate.taskId} on atom(s): ${finding.overlappingAtomIds.join(', ')}.`, {
                exitCode: 1,
                details: {
                  taskId: claimableTask.workItemId,
                  conflictWithTaskId: candidate.taskId,
                  conflictClaimActorId: conflictActorId,
                  overlappingAtomIds: finding.overlappingAtomIds,
                  verdict: 'blocked-cid-conflict',
                  closeoutOnlyHint: `If ${claimableTask.workItemId} already delivered its scoped files and only needs governed closeout, rerun next --claim with --claim-intent closeout-only.`
                }
              });
            }
            if (!parallelAdvisory) {
              parallelAdvisory = {
                ...finding,
                verdict: 'parallel-safe-with-cid-overlap-advisory',
                conflictWithTaskId: candidate.taskId,
                conflictClaimActorId: conflictActorId,
                admitted: true,
                admissionReason: claimIntent === 'closeout-only'
                  ? 'closeout-only-claim-intent'
                  : 'cid-overlap-without-active-write-claim'
              };
            }
            continue;
          }
          if (Array.isArray(finding.overlappingAtomIds) && finding.overlappingAtomIds.length > 0 && !parallelAdvisory) {
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
        ...(Array.isArray(claimableTask.targetAllowedFiles) ? claimableTask.targetAllowedFiles : [])
      ])).join(','),
      '--json'
    ]);
  claimLatencyPhases.push({ phase: shouldReuseActiveClaim ? 'renew-claim' : 'tasks-claim', durationMs: Date.now() - claimCommandStartedAt });
  if (shouldReuseActiveClaim && claimResult.ok && claimResult.evidence) {
    (claimResult.evidence as any).reusedActiveClaim = true;
    (claimResult.evidence as any).claimIntent = activeClaimIntent;
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
    allowedFiles: buildAllowedFilesForTask(claimableTask),
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
  const recommendedChannel = batchRun?.status === 'active' ? 'batch' : 'normal';
  recordBrokerClaimIntent({
    cwd: input.cwd,
    taskId: claimableTask.workItemId,
    actorId: resolvedActor.actorId,
    lane: recommendedChannel === 'batch' ? 'serial' : 'direct-brokered',
    targetFiles: directionLock.allowedFiles,
    ttlSeconds: 1800
  });
  const nextActionBase = {
    status: 'ready',
    command: `node atm.mjs start --cwd . --goal ${quoteCliValue(claimableTask.title)} --json`,
    reason: `claimed imported work item ${claimableTask.workItemId} for ${resolvedActor.actorId}`,
    recommendedChannel,
    claimIntent: resolvedClaimIntent,
    riskLevel: recommendedChannel === 'batch' ? 'high' : 'medium',
    playbook: buildChannelPlaybook({
      channel: recommendedChannel,
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
    channel: recommendedChannel,
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
  const userNotice = buildFirstUseUserNotice(nextAction as any);
  return makeResult({
    ok: true,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction as any,
      userNotice,
      input.integrationBootstrap,
      input.runtimeAdapterReadiness,
      message('info', 'ATM_NEXT_CLAIMED', 'Claimed the next imported work item.', {
        taskId: claimableTask.workItemId,
        actorId: resolvedActor.actorId,
        recommendedChannel: nextAction.recommendedChannel,
        claimIntent: resolvedClaimIntent,
        batchCheckpointCommand: nextAction.recommendedChannel === 'batch'
          ? 'node atm.mjs batch checkpoint --actor <id> --json'
          : null,
        blockedPattern: nextAction.recommendedChannel === 'batch'
          ? 'manual tasks reserve/promote/claim/close loop'
          : null,
        ignoredUntrackedFiles: scopeDiagnostic.ignoredUntrackedFiles,
        ignoredUntrackedNote: scopeDiagnostic.ignoredUntrackedFiles.length > 0
          ? 'These files are NOT blocking the claim. If any of them is actually a deliverable for this task, run `node atm.mjs tasks scope --add <paths>` to widen the scope and then `git add` them.'
          : null
      })
    ),
    evidence: {
      nextAction,
      claimIntent: resolvedClaimIntent,
      claimPreparation,
      claimResult: claimResult.evidence,
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

function buildPromptScopedNextResult(input: {
  readonly cwd: string;
  readonly taskIntent: TaskIntent | null;
  readonly importedTaskQueue: ImportedTaskQueue;
  readonly integrationBootstrap: unknown;
  readonly runtimeAdapterReadiness: unknown;
}) {
  const promptScope = input.importedTaskQueue.promptScope;
  if (!promptScope) return null;
  const selectedTasks = promptScope.selectedTasks;
  if (promptScope.status === 'empty') {
    const nextAction = {
      status: 'task-no-work',
      command: 'node atm.mjs next --cwd . --json',
      reason: 'the prompt points at a task scope, but no open imported work remains for that scope',
      taskIntent: input.taskIntent,
      candidates: [],
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
        input.integrationBootstrap as any,
        input.runtimeAdapterReadiness as any,
        message('info', 'ATM_NEXT_TASK_NO_WORK', 'The prompt points at a known task scope, but no open imported work remains for it.', {
          taskIntent: input.taskIntent,
          diagnostics: promptScope.diagnostics
        })
      ),
      evidence: {
        nextAction,
        taskIntent: input.taskIntent,
        importedTaskQueue: input.importedTaskQueue,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  if (promptScope.status === 'not-found') {
    const planningRootMissing = input.importedTaskQueue.planningRootMissing ?? null;
    const nonPlaybookHints = buildNonPlaybookRouteHints(input.cwd, input.taskIntent?.userPrompt ?? '');
    const nextAction = {
      status: planningRootMissing ? 'planning-root-missing' : 'task-scope-not-found',
      command: planningRootMissing?.requiredCommand ?? 'node atm.mjs next --prompt "<current user prompt>" --json',
      reason: planningRootMissing?.detail ?? 'the prompt mentions task scope, but no matching ATM task card or ledger task was found',
      taskIntent: input.taskIntent,
      candidates: [],
      planningRootMissing,
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands(),
      ...nonPlaybookHints
    };
    return makeResult({
      ok: false,
      command: 'next',
      cwd: input.cwd,
      messages: buildNextMessages(
        nextAction,
        null,
        input.integrationBootstrap as any,
        input.runtimeAdapterReadiness as any,
        planningRootMissing
          ? message('error', 'ATM_PLANNING_ROOT_MISSING', planningRootMissing.detail, planningRootMissing)
          : message('error', 'ATM_NEXT_TASK_SCOPE_NOT_FOUND', 'The prompt looks task-scoped, but ATM could not find a matching task.', {
            taskIntent: input.taskIntent
          })
      ),
      evidence: {
        nextAction,
        taskIntent: input.taskIntent,
        importedTaskQueue: input.importedTaskQueue,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  if (promptScope.status === 'ambiguous') {
    const nextAction = {
      status: 'task-selection-required',
      command: 'node atm.mjs next --prompt "<more specific prompt with task id or plan path>" --json',
      reason: 'the prompt matches multiple task scopes; ATM will not choose a global task by accident',
      candidates: selectedTasks,
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    };
    return makeResult({
      ok: false,
      command: 'next',
      cwd: input.cwd,
      messages: buildNextMessages(
        nextAction,
        null,
        input.integrationBootstrap as any,
        input.runtimeAdapterReadiness as any,
        message('error', 'ATM_NEXT_TASK_SELECTION_REQUIRED', 'The prompt matches multiple task cards; choose a task id or plan scope before continuing.', {
          candidateCount: selectedTasks.length,
          candidates: selectedTasks.slice(0, 12).map(toTaskCandidateView)
        })
      ),
      evidence: {
        nextAction,
        taskIntent: input.taskIntent,
        importedTaskQueue: input.importedTaskQueue,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  if (promptScope.status === 'queue') {
    const queueHeadTask = input.importedTaskQueue.selectedTask ?? selectedTasks[0] ?? null;
    const requestedQueuePrompt = input.taskIntent?.userPrompt ?? queueHeadTask?.workItemId ?? 'prompt-scoped task queue';
    const activeQueue = findActiveTaskQueueForIntent(input.cwd, input.taskIntent, {
      sourcePromptFallback: requestedQueuePrompt,
      taskId: queueHeadTask?.workItemId ?? null
    });
    const activeBatch = activeQueue?.batchId
      ? readActiveBatchRun(input.cwd, { batchId: activeQueue.batchId })
      : findActiveBatchRunForIntent(input.cwd, input.taskIntent, {
        sourcePromptFallback: requestedQueuePrompt,
        taskId: queueHeadTask?.workItemId ?? null
      });
    const queuePrompt = activeBatch?.sourcePrompt ?? activeQueue?.sourcePrompt ?? requestedQueuePrompt;
    const activeBatchQueue = activeBatch && !activeQueue
      ? findActiveTaskQueue(input.cwd, activeBatch.sourcePrompt, { batchId: activeBatch.batchId })
      : activeQueue;
    const consistency = inspectBatchRunConsistency(activeBatch, activeBatch ? activeBatchQueue : null);
    if (!consistency.ok) {
      const nextAction = {
        status: 'batch-state-repair-required',
        command: activeBatch ? `node atm.mjs batch repair --actor <id> --batch ${activeBatch.batchId} --json` : 'node atm.mjs batch repair --actor <id> --json',
        reason: 'active batch runtime is inconsistent; repair it before claiming, editing, closing, or committing',
        recommendedChannel: 'batch',
        riskLevel: 'high',
        requiredCommand: activeBatch ? `node atm.mjs batch repair --actor <id> --batch ${activeBatch.batchId} --json` : 'node atm.mjs batch repair --actor <id> --json',
        playbook: buildChannelPlaybook({
          channel: 'batch',
          taskId: queueHeadTask?.workItemId ?? null,
          queueHeadTaskId: queueHeadTask?.workItemId ?? null,
          originalPrompt: queuePrompt,
          batchId: activeBatch?.batchId ?? null,
          batchState: 'repair-required'
        }),
        blockedCommands: blockedMutationCommands()
      };
      return makeResult({
        ok: false,
        command: 'next',
        cwd: input.cwd,
        messages: buildNextMessages(
          nextAction,
          null,
          input.integrationBootstrap as any,
          input.runtimeAdapterReadiness as any,
          message('error', 'ATM_BATCH_STATE_REPAIR_REQUIRED', 'ATM detected an inconsistent active batch. Repair the runtime before continuing.', {
            batchId: activeBatch?.batchId ?? null,
            reason: consistency.reason,
            batchHeadTaskId: consistency.batchHeadTaskId,
            queueHeadTaskId: consistency.queueHeadTaskId,
            requiredCommand: nextAction.requiredCommand
          })
        ),
        evidence: {
          nextAction,
          recommendedChannel: 'batch',
          batchRun: activeBatch,
          taskQueue: activeBatchQueue,
          consistency,
          taskIntent: input.taskIntent,
          importedTaskQueue: input.importedTaskQueue
        }
      });
    }
    const queueHeadTaskId = activeBatchQueue?.taskIds[activeBatchQueue.currentIndex] ?? queueHeadTask?.workItemId ?? null;
    const queuePreview = {
      schemaId: 'atm.taskQueuePreview.v1',
      sourcePrompt: queuePrompt,
      batchId: activeBatch?.batchId ?? null,
      scopeKey: activeBatch?.scopeKey ?? null,
      targetRepo: selectedTasks.find((task) => task.targetRepo)?.targetRepo ?? null,
      taskIds: selectedTasks.map((task) => task.workItemId),
      currentIndex: activeBatchQueue?.currentIndex ?? 0,
      queueHeadTaskId
    };
    const nextAction = embedTeamRecommendation({
      status: 'task-queue-ready',
      command: queueHeadTask
        ? `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(queuePrompt)} --auto-intent --json`
        : 'node atm.mjs next --prompt "<current user prompt>" --json',
      reason: 'the prompt resolves to a scoped task queue; claim one task at a time',
      recommendedChannel: 'batch',
      riskLevel: 'high',
      requiredCommand: queueHeadTask
        ? `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(queuePrompt)} --auto-intent --json`
        : 'node atm.mjs next --prompt "<current user prompt>" --json',
      batchInstruction: 'This is a batch run. Do not switch to per-task normal flow. After next --claim, deliver only the current queue head and run node atm.mjs batch checkpoint --actor <id> --json. Do not manually loop over tasks reserve/promote/claim/close.',
      playbook: buildChannelPlaybook({
        channel: 'batch',
        taskId: queueHeadTaskId ?? undefined,
        queueHeadTaskId,
        originalPrompt: queuePrompt,
        batchId: activeBatch?.batchId ?? null,
        batchState: activeBatch ? 'queue-head-active' : 'queue-preview'
      }),
      deliveryPrinciple: buildTaskDeliveryPrinciple({
        channel: 'batch',
        taskId: queueHeadTaskId ?? undefined
      }),
      selectedTasks,
      taskQueue: activeBatchQueue ?? queuePreview,
      queueId: activeBatchQueue?.queueId ?? null,
      batchId: activeBatch?.batchId ?? null,
      scopeKey: activeBatch?.scopeKey ?? null,
      queueHeadTaskId,
      queueSize: selectedTasks.length,
      governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
        channel: 'batch',
        prompt: queuePrompt,
        taskId: queueHeadTaskId
      }),
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    }, {
      taskId: queueHeadTaskId,
      channel: 'batch',
      ...(queueHeadTaskId ? {
        knowledgeSummary: buildTeamKnowledgeSummary({
          cwd: input.cwd,
          taskId: queueHeadTaskId,
          top: 3
        })
      } : {})
    });
    return makeResult({
      ok: true,
      command: 'next',
      cwd: input.cwd,
      messages: buildNextMessages(
        nextAction,
        null,
        input.integrationBootstrap as any,
        input.runtimeAdapterReadiness as any,
        message('info', 'ATM_NEXT_TASK_QUEUE_READY', 'ATM resolved the prompt to a scoped task queue.', {
          queueSize: selectedTasks.length,
          queueId: activeBatchQueue?.queueId ?? null,
          queueHeadTaskId,
          firstTask: queueHeadTask ? toTaskCandidateView(queueHeadTask) : null,
          requiredCommand: nextAction.command,
          batchCheckpointCommand: 'node atm.mjs batch checkpoint --actor <id> --json',
          blockedPattern: 'manual tasks reserve/promote/claim/close loop'
        })
      ),
      evidence: {
        nextAction,
        recommendedChannel: 'batch',
        taskQueue: activeBatchQueue ?? queuePreview,
        agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
        taskIntent: input.taskIntent,
        importedTaskQueue: input.importedTaskQueue,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  const selectedTask = selectedTasks[0] ?? null;
  if (!selectedTask) return null;
  const deliveryClassification = classifyTaskDelivery({
    cwd: input.cwd,
    task: {
      workItemId: selectedTask.workItemId,
      status: selectedTask.status,
      targetRepo: selectedTask.targetRepo,
      closureAuthority: selectedTask.closureAuthority,
      planningRepo: selectedTask.planningRepo,
      sourcePlanPath: selectedTask.sourcePlanPath,
      taskPath: selectedTask.taskPath
    }
  });
  const sourceStatus = deliveryClassification.sourceStatus;
  const ledgerStatus = deliveryClassification.ledgerStatus;

  if (deliveryClassification.intent === 'mirror-sync-only'
    && input.taskIntent?.requestedAction !== 'redo'
    && input.taskIntent?.requestedAction !== 'reopen') {
    const mirrorSyncTask = withMirrorSyncOnlyTarget(selectedTask);
    const mirrorSyncQueue = withMirrorSyncOnlyTargetQueue(input.importedTaskQueue, selectedTask.workItemId);
    const nextAction = buildMirrorSyncNextAction({
      task: mirrorSyncTask,
      classification: deliveryClassification
    });
    return makeResult({
      ok: true,
      command: 'next',
      cwd: input.cwd,
      messages: buildNextMessages(
        nextAction as any,
        null,
        input.integrationBootstrap as any,
        input.runtimeAdapterReadiness as any,
        message('info', 'ATM_NEXT_TASK_MIRROR_SYNC_REQUIRED', 'ATM detected a planning-only task; deliverables live in another repo. Sync the ledger mirror instead of running a delivery playbook here.', {
          task: toTaskCandidateView(mirrorSyncTask),
          classification: deliveryClassification,
          requiredCommand: nextAction.requiredCommand
        })
      ),
      evidence: {
        nextAction,
        recommendedChannel: nextAction.recommendedChannel,
        deliveryClassification,
        taskIntent: input.taskIntent,
        importedTaskQueue: mirrorSyncQueue,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }

  const isHistoricalDoneStale = sourceStatus?.toLowerCase() === 'done'
    && (ledgerStatus?.toLowerCase() !== 'done' || !selectedTask.closedAt || !selectedTask.closurePacket);

  if (isHistoricalDoneStale) {
    const nextAction = {
      status: 'task-reconcile-suggested',
      command: `node atm.mjs tasks reconcile --task ${selectedTask.workItemId} --actor <id> --delivery-commit <historicalCommitSha> --json`,
      reason: `task ${selectedTask.workItemId} is marked as done in the planning card but the target ledger is not closed yet; reconcile it using the historical sync channel`,
      recommendedChannel: 'reconcile',
      riskLevel: 'low',
      selectedTask,
      requiredCommand: `node atm.mjs tasks reconcile --task ${selectedTask.workItemId} --actor <id> --delivery-commit <historicalCommitSha> --json`,
      playbook: {
        schemaId: 'atm.playbook.v1',
        channel: 'reconcile',
        steps: [
          `Find the historical Git commit SHA that delivered this task's changes (e.g., e26f3a73)`,
          `Run node atm.mjs tasks reconcile --task ${selectedTask.workItemId} --actor <actorId> --delivery-commit <historicalCommitSha> --json`,
          `This will automatically generate the closure packet, update the ledger status to done, write task-events, and synchronize the governance record without claiming the task or mutating source files.`
        ]
      },
      allowedCommands: [
        `node atm.mjs tasks reconcile --task ${selectedTask.workItemId} --actor <id> --delivery-commit <historicalCommitSha> --json`,
        ...allowedGuidanceBootstrapCommands()
      ],
      blockedCommands: [
        'mutating source files during historical reconcile',
        'manual ledger JSON edit'
      ]
    };
    return makeResult({
      ok: true,
      command: 'next',
      cwd: input.cwd,
      messages: buildNextMessages(
        nextAction as any,
        null,
        input.integrationBootstrap as any,
        input.runtimeAdapterReadiness as any,
        message('info', 'ATM_NEXT_TASK_RECONCILE_SUGGESTED', `Task ${selectedTask.workItemId} is done in planning but ledger is open. Reconcile with historical sync.`, {
          task: toTaskCandidateView(selectedTask),
          requiredCommand: nextAction.requiredCommand
        })
      ),
      evidence: {
        nextAction,
        recommendedChannel: 'reconcile',
        taskIntent: input.taskIntent,
        importedTaskQueue: input.importedTaskQueue,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  if (isClosedTaskStatus(selectedTask.status) && input.taskIntent?.requestedAction !== 'redo' && input.taskIntent?.requestedAction !== 'reopen') {
    const nextAction = {
      status: 'task-already-closed',
      command: 'node atm.mjs next --prompt "<current user prompt>" --json',
      reason: `task ${selectedTask.workItemId} is already ${normalizeTaskRouteStatus(selectedTask.status)}; do not edit planning task cards to simulate closure`,
      recommendedChannel: 'normal',
      riskLevel: 'low',
      selectedTask,
      closure: {
        taskId: selectedTask.workItemId,
        status: normalizeTaskRouteStatus(selectedTask.status),
        closedAt: selectedTask.closedAt,
        closedByActor: selectedTask.closedByActor,
        closurePacketPath: selectedTask.closurePacket,
        lastTransitionId: selectedTask.lastTransitionId,
        lastTransitionAt: selectedTask.lastTransitionAt
      },
      planningStatusSync: {
        authority: 'atm-ledger',
        instruction: 'Planning task-card status is only a mirror. Official closure must come from the ATM task ledger close transition and closure packet.'
      },
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: [
        ...blockedMutationCommands(),
        'manual planning task-card status: done as completion evidence'
      ]
    };
    return makeResult({
      ok: true,
      command: 'next',
      cwd: input.cwd,
      messages: buildNextMessages(
        nextAction,
        null,
        input.integrationBootstrap as any,
        input.runtimeAdapterReadiness as any,
        message('info', 'ATM_NEXT_TASK_ALREADY_CLOSED', 'ATM found the task, and it is already closed in the task ledger.', {
          task: toTaskCandidateView(selectedTask),
          closure: nextAction.closure,
          planningStatusSync: nextAction.planningStatusSync
        })
      ),
      evidence: {
        nextAction,
        recommendedChannel: 'normal',
        taskIntent: input.taskIntent,
        importedTaskQueue: input.importedTaskQueue,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  const activeBatch = readActiveBatchRun(input.cwd, { taskId: selectedTask.workItemId });
  if (activeBatch?.status === 'active' && activeBatch.taskIds.includes(selectedTask.workItemId)) {
    const activeQueue = findActiveTaskQueue(input.cwd, activeBatch.sourcePrompt, { batchId: activeBatch.batchId }) ?? findActiveTaskQueue(input.cwd, null, { batchId: activeBatch.batchId });
    const consistency = inspectBatchRunConsistency(activeBatch, activeQueue);
    if (!consistency.ok) {
      const nextAction = {
        status: 'batch-state-repair-required',
        command: `node atm.mjs batch repair --actor <id> --batch ${activeBatch.batchId} --json`,
        reason: 'active batch runtime is inconsistent; repair it before claiming, editing, closing, or committing',
        recommendedChannel: 'batch',
        riskLevel: 'high',
        requiredCommand: `node atm.mjs batch repair --actor <id> --batch ${activeBatch.batchId} --json`,
        blockedCommands: blockedMutationCommands()
      };
      return makeResult({
        ok: false,
        command: 'next',
        cwd: input.cwd,
        messages: buildNextMessages(
          nextAction,
          null,
          input.integrationBootstrap as any,
          input.runtimeAdapterReadiness as any,
          message('error', 'ATM_BATCH_STATE_REPAIR_REQUIRED', 'ATM detected an inconsistent active batch. Repair the runtime before continuing.', {
            batchId: activeBatch.batchId,
            reason: consistency.reason,
            batchHeadTaskId: consistency.batchHeadTaskId,
            queueHeadTaskId: consistency.queueHeadTaskId,
            requiredCommand: nextAction.requiredCommand
          })
        ),
        evidence: {
          nextAction,
          recommendedChannel: 'batch',
          batchRun: activeBatch,
          taskQueue: activeQueue,
          consistency,
          taskIntent: input.taskIntent,
          importedTaskQueue: input.importedTaskQueue
        }
      });
    }
    const queueHeadTaskId = activeBatch.currentTaskId
      ?? activeQueue?.taskIds[activeQueue.currentIndex]
      ?? selectedTask.workItemId;
    const taskQueue = activeQueue ? {
      queueId: activeQueue.queueId,
      sourcePrompt: activeQueue.sourcePrompt,
      taskIds: activeQueue.taskIds,
      currentIndex: activeQueue.currentIndex,
      queueHeadTaskId
    } : {
      schemaId: 'atm.taskQueuePreview.v1',
      sourcePrompt: activeBatch.sourcePrompt,
      targetRepo: selectedTask.targetRepo ?? null,
      taskIds: activeBatch.taskIds,
      currentIndex: activeBatch.currentIndex,
      queueHeadTaskId
    };
    const nextAction = embedTeamRecommendation({
      status: 'task-batch-context-active',
      command: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(activeBatch.sourcePrompt)} --auto-intent --json`,
      reason: `task ${selectedTask.workItemId} belongs to active batch ${activeBatch.batchId}; continue through the current batch queue head`,
      recommendedChannel: 'batch',
      riskLevel: 'high',
      batchInstruction: `This is a batch run. Do not switch to per-task normal flow. Deliver only queue head ${queueHeadTaskId}, then run node atm.mjs batch checkpoint --actor <id> --json to close, advance, and claim the next task.`,
      playbook: buildChannelPlaybook({
        channel: 'batch',
        taskId: queueHeadTaskId ?? selectedTask.workItemId,
        queueHeadTaskId,
        originalPrompt: activeBatch.sourcePrompt,
        batchId: activeBatch.batchId,
        batchState: 'queue-head-active'
      }),
      deliveryPrinciple: buildTaskDeliveryPrinciple({
        channel: 'batch',
        taskId: queueHeadTaskId ?? selectedTask.workItemId
      }),
      selectedTask,
      targetRepo: selectedTask.targetRepo,
      requiredCommand: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(activeBatch.sourcePrompt)} --auto-intent --json`,
      taskQueue,
      queueId: activeQueue?.queueId ?? activeBatch.batchId,
      batchId: activeBatch.batchId,
      scopeKey: activeBatch.scopeKey,
      queueHeadTaskId,
      queueSize: activeBatch.taskIds.length,
      activeBatchRunId: activeBatch.batchId,
      governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
        channel: 'batch',
        prompt: activeBatch.sourcePrompt,
        taskId: queueHeadTaskId ?? selectedTask.workItemId
      }),
      allowedCommands: allowedGuidanceBootstrapCommands(),
      blockedCommands: blockedMutationCommands()
    }, {
      taskId: queueHeadTaskId ?? selectedTask.workItemId,
      channel: 'batch',
      knowledgeSummary: buildTeamKnowledgeSummary({
        cwd: input.cwd,
        taskId: queueHeadTaskId ?? selectedTask.workItemId,
        top: 3
      })
    });
    return makeResult({
      ok: true,
      command: 'next',
      cwd: input.cwd,
      messages: buildNextMessages(
        nextAction,
        null,
        input.integrationBootstrap as any,
        input.runtimeAdapterReadiness as any,
        message('info', 'ATM_NEXT_TASK_QUEUE_READY', 'ATM kept this task inside the active batch context.', {
          queueSize: activeBatch.taskIds.length,
          queueId: activeQueue?.queueId ?? activeBatch.batchId,
          queueHeadTaskId,
          selectedTaskId: selectedTask.workItemId,
          requiredCommand: nextAction.requiredCommand,
          batchCheckpointCommand: 'node atm.mjs batch checkpoint --actor <id> --json',
          blockedPattern: 'manual per-task normal-flow switching during active batch'
        })
      ),
      evidence: {
        nextAction,
        recommendedChannel: 'batch',
        batchRun: activeBatch,
        taskQueue,
        agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
        taskIntent: input.taskIntent,
        importedTaskQueue: input.importedTaskQueue,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  const explicitTaskSelector = input.taskIntent?.explicitTaskIds.length === 1
    && findTaskByTaskIdReference([selectedTask], input.taskIntent.explicitTaskIds[0])?.workItemId === selectedTask.workItemId
    ? input.taskIntent.explicitTaskIds[0]
    : null;
  const normalClaimCommand = explicitTaskSelector
    ? `node atm.mjs next --claim --actor <id> --task ${explicitTaskSelector} --auto-intent --json`
    : `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(input.taskIntent?.userPrompt ?? selectedTask.workItemId)} --auto-intent --json`;
  const taskScopedClaimCommand = `node atm.mjs next --claim --actor <id> --task ${selectedTask.workItemId} --auto-intent --json`;
  const nextAction = embedTeamRecommendation({
    status: 'task-route-ready',
    command: normalClaimCommand,
    reason: `the prompt resolves to task ${selectedTask.workItemId}`,
    recommendedChannel: 'normal',
    riskLevel: 'medium',
    taskScopedClaimCommand,
    claimCommandShape: explicitTaskSelector ? 'task-scoped' : 'prompt-scoped',
    playbook: buildChannelPlaybook({
      channel: 'normal',
      taskId: selectedTask.workItemId,
      originalPrompt: input.taskIntent?.userPrompt ?? selectedTask.workItemId
    }),
    governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
      channel: 'normal',
      prompt: input.taskIntent?.userPrompt ?? selectedTask.workItemId,
      taskId: selectedTask.workItemId
    }),
    deliveryPrinciple: buildTaskDeliveryPrinciple({
      channel: 'normal',
      taskId: selectedTask.workItemId
    }),
    selectedTask,
    targetRepo: selectedTask.targetRepo,
    requiredCommand: normalClaimCommand,
    allowedCommands: allowedGuidanceBootstrapCommands(),
    blockedCommands: blockedMutationCommands()
  }, {
    taskId: selectedTask.workItemId,
    channel: 'normal',
    knowledgeSummary: buildTeamKnowledgeSummary({
      cwd: input.cwd,
      taskId: selectedTask.workItemId,
      top: 3
    })
  });
  return makeResult({
    ok: true,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction,
      null,
      input.integrationBootstrap as any,
      input.runtimeAdapterReadiness as any,
      message('info', 'ATM_NEXT_TASK_ROUTE_READY', 'ATM resolved the prompt to one task route.', {
        task: toTaskCandidateView(selectedTask),
        requiredCommand: nextAction.requiredCommand
      })
    ),
    evidence: {
      nextAction,
      recommendedChannel: 'normal',
      agent_pack_hint: buildAgentPackHint(nextAction.status, nextAction.command, nextAction.reason),
      taskIntent: input.taskIntent,
      importedTaskQueue: input.importedTaskQueue,
      integrationBootstrap: input.integrationBootstrap,
      runtimeAdapterReadiness: input.runtimeAdapterReadiness
    }
  });
}

function buildPromptGuidanceNextResult(input: {
  readonly cwd: string;
  readonly taskIntent: TaskIntent | null;
  readonly integrationBootstrap: unknown;
  readonly runtimeAdapterReadiness: unknown;
}) {
  const prompt = input.taskIntent?.userPrompt?.trim();
  if (!prompt || input.taskIntent?.taskScopeMentioned === true) return null;
  const quickfixScope = resolveQuickfixScope(prompt);
  if (isQuickfixPrompt(prompt) && quickfixScope.length > 0) {
    const nextAction = {
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
        prompt
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
        nextAction as any,
        null,
        input.integrationBootstrap as any,
        input.runtimeAdapterReadiness as any,
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
    const nextAction = {
      status: 'framework-temp-claim-required',
      command: claimCommand,
      reason: 'the prompt appears to be ATM framework maintenance without a human task card, so use a temporary runtime claim before editing critical framework files',
      recommendedChannel: 'fast',
      riskLevel: 'high',
      playbook: buildChannelPlaybook({
        channel: 'fast',
        originalPrompt: prompt
      }),
      governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
        channel: 'fast',
        prompt,
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
        input.integrationBootstrap as any,
        input.runtimeAdapterReadiness as any,
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
  const nextAction = {
    status: 'prompt-guidance-required',
    command: `node atm.mjs guide --goal ${quoteCliValue(prompt)} --cwd . --json`,
    reason: 'the user supplied a prompt that is not task-scoped, so ATM routes guidance from that prompt instead of reusing stale global guidance',
    recommendedChannel: null,
    riskLevel: 'medium',
    governanceReadiness: buildGovernanceReadinessHint(input.cwd, {
      channel: null,
      prompt
    }),
    allowedCommands: allowedGuidanceBootstrapCommands(),
    blockedCommands: blockedMutationCommands(),
    ...buildNonPlaybookRouteHints(input.cwd, prompt)
  };
  const userNotice = buildFirstUseUserNotice(nextAction as any);
  return makeResult({
    ok: true,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction,
      userNotice,
      input.integrationBootstrap as any,
      input.runtimeAdapterReadiness as any,
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
  readonly integrationBootstrap: unknown;
  readonly runtimeAdapterReadiness: unknown;
}) {
  const candidatePreview = input.importedTaskQueue.tasks.slice(0, 12).map(toTaskCandidateView);
  const nextAction = {
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
      'manual tasks reserve/promote/claim/close loops without prompt-scoped next',
      'batch task closure without node atm.mjs batch checkpoint --actor <id> --json'
    ]
  };
  return makeResult({
    ok: false,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction as any,
      null,
      input.integrationBootstrap as any,
      input.runtimeAdapterReadiness as any,
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

function allowedGuidanceBootstrapCommands() {
  return [
    'node atm.mjs orient --cwd . --json',
    'node atm.mjs start --cwd . --goal "<goal>" --json',
    'node atm.mjs next --prompt "<current user prompt>" --json',
    'node atm.mjs next --cwd . --json',
    'node atm.mjs explain --why blocked --json'
  ];
}

function blockedMutationCommands() {
  return [
    'host mutation without active guidance session',
    'manual task lifecycle loop without prompt-scoped next',
    'batch task closure without batch checkpoint',
    'atomize/infect/split apply without dry-run proposal',
    'apply without human review approval'
  ];
}

export interface PromptScopedTaskContext {
  readonly taskIntent: {
    readonly userPrompt: string | null;
    readonly explicitTaskIds: readonly string[];
    readonly taskScopeMentioned: boolean;
    readonly requestedAction: RequestedTaskAction | null;
    readonly source: TaskIntentSource;
  } | null;
  readonly promptScope: {
    readonly status: PromptScopedRouteStatus;
    readonly selectedTasks: readonly ImportedTaskSummary[];
    readonly targetRepo: string | null;
    readonly diagnostics: readonly string[];
  } | null;
}

function inspectImportedTaskQueue(cwd: string, taskIntent: TaskIntent | null, claimIntent: NextClaimIntent = 'write'): ImportedTaskQueue {
  const planningRootResolution = resolveCandidatePlanningRoots(cwd, {
    configuredRoots: readConfiguredPlanningRoots(cwd)
  });
  const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
  const jsonTasks = existsSync(taskStorePath) ? readdirSync(taskStorePath)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry): ImportedTaskSummaryWithOutOfScope[] => {
      const filePath = path.join(taskStorePath, entry);
      try {
        const parsed = parseJsonText(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
        const schemaVersion = typeof parsed.schemaVersion === 'string' ? parsed.schemaVersion : '';
        if (schemaVersion !== 'atm.workItem.v0.2' && parsed.source === undefined) {
          return [];
        }
        const workItemId = typeof parsed.workItemId === 'string'
          ? parsed.workItemId
          : typeof parsed.id === 'string'
            ? parsed.id
            : '';
        if (!workItemId) return [];
        const dependencies = Array.isArray(parsed.dependencies)
          ? parsed.dependencies.filter((entry): entry is string => typeof entry === 'string')
          : [];
        const claimRecord = parsed.claim && typeof parsed.claim === 'object' && !Array.isArray(parsed.claim)
          ? parsed.claim as Record<string, unknown>
          : {};
        const source = parsed.source && typeof parsed.source === 'object' ? parsed.source as Record<string, unknown> : {};
        const outOfScope = readStringArray(parsed.outOfScope ?? parsed.out_of_scope ?? parsed.forbidden_files ?? parsed.forbiddenFiles);
        return [finalizeImportedTaskSummary({
          workItemId,
          title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : workItemId,
          status: typeof parsed.status === 'string' ? parsed.status : 'planned',
          closedAt: normalizeOptionalString(parsed.closedAt ?? parsed.closed_at),
          closedByActor: normalizeOptionalString(parsed.closedByActor ?? parsed.closed_by_actor),
          closurePacket: normalizeOptionalString(parsed.closurePacket ?? parsed.closure_packet),
          lastTransitionId: normalizeOptionalString(parsed.lastTransitionId ?? parsed.last_transition_id),
          lastTransitionAt: normalizeOptionalString(parsed.lastTransitionAt ?? parsed.last_transition_at),
          milestone: typeof parsed.milestone === 'string' ? parsed.milestone : null,
          dependencies,
          taskPath: path.relative(cwd, filePath).replace(/\\/g, '/'),
          format: 'json',
          sourcePlanPath: normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path),
          nearbyPlanPaths: [],
          scopePaths: (() => {
            const explicit = uniqueSorted([
              ...readStringArray(parsed.scope),
              ...readStringArray(parsed.scopePaths),
              ...readStringArray(parsed.files)
            ].map((p) => {
              const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
              return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
            }));
            const claimFiles = readStringArray(claimRecord.files);
            const rawScope = explicit.length > 0
              ? uniqueSorted([
                ...explicit,
                ...claimFiles.filter((file) => isPathAllowedByScope(file, explicit))
              ])
              : uniqueSorted([
                ...extractDeclaredTaskPathsFromDocument(parsed),
                ...extractLinkedSourceTaskArtifactPaths(cwd, normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path))
              ].map((p) => {
                const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
                return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
              }));
            return outOfScope.length > 0
              ? rawScope.filter((entry) => !isPathAllowedByScope(entry, outOfScope))
              : rawScope;
          })(),
          outOfScope,
          targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo ?? parsed.upstream_repo ?? parsed.upstreamRepo),
          planningRepo: normalizeOptionalString(parsed.planning_repo ?? parsed.planningRepo),
          allowPlanningMirror: allowsPlanningMirror(parsed),
          closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
          activeClaimActorId: claimRecord.state === 'active' && typeof claimRecord.actorId === 'string'
            ? claimRecord.actorId
            : null,
          activeClaimIntent: claimRecord.state === 'active' && typeof claimRecord.intent === 'string'
            ? claimRecord.intent
            : (claimRecord.state === 'active' ? 'write' : null)
        }, cwd)];
      } catch {
        return [];
      }
    }) : [];
  const skipMarkdownTaskDiscovery = shouldSkipMarkdownTaskDiscovery(cwd, jsonTasks, taskIntent);
  const skipExternalTaskCardScan = skipMarkdownTaskDiscovery || shouldSkipExternalTaskCardScan(cwd, jsonTasks, taskIntent);
  const markdownTaskFiles = shouldDiscoverMarkdownTaskCards(taskIntent) && !skipMarkdownTaskDiscovery
    ? uniqueSorted([
      ...listTaskCardFiles(cwd),
      ...(skipExternalTaskCardScan ? [] : listPromptScopedExternalTaskCardFiles(cwd, taskIntent, planningRootResolution.roots))
    ])
    : [];
  const markdownTasks = markdownTaskFiles
    .map((filePath): ImportedTaskSummaryWithOutOfScope | null => {
      const rawText = readFileSync(filePath, 'utf8');
      const parsed = parseMarkdownFrontmatter(rawText);
      const workItemId = normalizeOptionalString(parsed.task_id ?? parsed.taskId ?? parsed.workItemId ?? parsed.id)
        ?? path.basename(filePath).replace(/\.task\.md$/, '');
      if (!workItemId) return null;
      const dependencies = splitListValue(parsed.dependencies ?? parsed.depends_on ?? parsed.dependsOn ?? parsed.blocked_by ?? parsed.blockedBy);
      const relativeTaskPath = path.relative(cwd, filePath).replace(/\\/g, '/');
      const outOfScope = splitListValue(parsed.outOfScope ?? parsed.out_of_scope ?? parsed.forbidden_files ?? parsed.forbiddenFiles);
      return finalizeImportedTaskSummary({
        workItemId,
        title: normalizeOptionalString(parsed.title ?? parsed.name) ?? workItemId,
        status: normalizeOptionalString(parsed.status) ?? 'planned',
        closedAt: normalizeOptionalString(parsed.closed_at ?? parsed.closedAt),
        closedByActor: normalizeOptionalString(parsed.closed_by_actor ?? parsed.closedByActor),
        closurePacket: normalizeOptionalString(parsed.closure_packet ?? parsed.closurePacket),
        lastTransitionId: normalizeOptionalString(parsed.last_transition_id ?? parsed.lastTransitionId),
        lastTransitionAt: normalizeOptionalString(parsed.last_transition_at ?? parsed.lastTransitionAt),
        milestone: normalizeOptionalString(parsed.milestone),
        dependencies,
        taskPath: relativeTaskPath,
        format: 'markdown',
        sourcePlanPath: normalizeOptionalString(parsed.plan_path ?? parsed.planPath ?? parsed.source_plan ?? parsed.sourcePlan ?? parsed.related_plan ?? parsed.relatedPlan),
        nearbyPlanPaths: findNearbyPlanPaths(cwd, filePath),
        scopePaths: (() => {
          const explicit = uniqueSorted([
            ...splitListValue(parsed.scope ?? parsed.scope_paths ?? parsed.scopePaths),
            ...splitListValue(parsed.files ?? parsed.file_paths ?? parsed.filePaths),
            ...splitListValue(parsed.allowed_files ?? parsed.allowedFiles),
            ...splitListValue(parsed.deliverables),
            ...splitListValue(parsed.paths)
          ].map((p) => {
            const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
            return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
          }));
          const rawScope = explicit.length > 0
            ? explicit
            : uniqueSorted([
              ...extractTaskArtifactPathsFromMarkdown(cwd, rawText)
            ].map((p) => {
              const norm = p.replace(/\\/g, '/').replace(/^\.\//, '').trim();
              return path.isAbsolute(norm) ? path.relative(cwd, norm).replace(/\\/g, '/') : norm;
            }));
          return outOfScope.length > 0
            ? rawScope.filter((entry) => !isPathAllowedByScope(entry, outOfScope))
            : rawScope;
        })(),
        outOfScope,
        targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo ?? parsed.upstream_repo ?? parsed.upstreamRepo),
        planningRepo: normalizeOptionalString(parsed.planning_repo ?? parsed.planningRepo),
        allowPlanningMirror: allowsPlanningMirror(parsed),
        closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
        activeClaimActorId: null,
        activeClaimIntent: null
      }, cwd);
    })
    .filter((entry): entry is ImportedTaskSummaryWithOutOfScope => entry !== null);
  const allTasks = dedupeTasks([...jsonTasks, ...markdownTasks]);

  const tasks = allTasks
    .filter((task) => isTaskRoutable(task.status, taskIntent) || isTaskExplicitlyMentioned(task, taskIntent))
    .sort((left, right) => {
      const statusWeight = statusQueueWeight(left.status) - statusQueueWeight(right.status);
      return statusWeight !== 0 ? statusWeight : left.workItemId.localeCompare(right.workItemId);
    });
  const statusById = new Map(allTasks.map((task) => [task.workItemId, task.status]));
  const activeQueue = findActiveTaskQueueForIntent(cwd, taskIntent);
  const activeQueueTasks = activeQueue
    ? activeQueue.taskIds
      .slice(activeQueue.currentIndex)
      .map((taskId) => allTasks.find((task) => task.workItemId === taskId))
      .filter((task): task is ImportedTaskSummary => Boolean(task))
    : [];
  const promptScope = activeQueue && activeQueueTasks.length > 0
    ? {
      status: 'queue' as const,
      selectedTasks: activeQueueTasks,
      targetRepo: activeQueue.targetRepo,
      diagnostics: [`active-queue:${activeQueue.queueId}`, `queue-index:${activeQueue.currentIndex}`]
    }
    : resolvePromptScopedTaskRoute(cwd, tasks, taskIntent, planningRootResolution);
  const planningRootMissing = promptScope?.status === 'not-found' && taskIntent
    ? shouldReportPlanningRootMissing({
      cwd,
      taskScopeMentioned: taskIntent.taskScopeMentioned,
      mentionedPlanPaths: taskIntent.mentionedPlanPaths,
      userPrompt: taskIntent.userPrompt,
      matchedTaskCount: tasks.filter((task) => (task.matchScore ?? 0) > 0).length
    })
    : null;
  const selectedTaskPool = promptScope?.selectedTasks ?? [];
  const explicitSingleTaskRoute = isExplicitSingleTaskRoute(promptScope, taskIntent);
  const selectedTask = selectImportedTaskForPromptScope(
    selectedTaskPool,
    promptScope?.status === 'queue',
    explicitSingleTaskRoute,
    statusById,
    cwd
  );
  const claimableTask = selectedTask
    && selectedTask.format === 'json'
    && (isSelectedTaskClaimableForIntent(selectedTask, claimIntent) || isTaskAlreadyActivelyClaimed(selectedTask))
    && (areTaskDependenciesSatisfied(selectedTask, statusById, cwd) || isTaskAlreadyActivelyClaimed(selectedTask))
    ? selectedTask
    : null;

  return {
    taskStorePath: existsSync(taskStorePath) ? path.relative(cwd, taskStorePath).replace(/\\/g, '/') : '.atm/history/tasks',
    openTaskCount: tasks.length,
    selectedTask,
    claimableTask,
    tasks,
    promptScope,
    planningRootWarnings: planningRootResolution.warnings,
    planningRootMissing
  };
}

export function shouldSkipExternalTaskCardScan(
  cwd: string,
  jsonTasks: readonly ImportedTaskSummary[],
  taskIntent: TaskIntent | null
): boolean {
  if (!taskIntent?.taskScopeMentioned) return false;
  if (taskIntent.mentionedPlanPaths.length > 0) return false;
  const promptScopedJsonRoute = resolvePromptScopedTaskRoute(cwd, jsonTasks, taskIntent);
  if (promptScopedJsonRoute && promptScopedJsonRoute.selectedTasks.length > 0) {
    return true;
  }
  if (taskIntent.mentionedTaskIds.length === 0 && taskIntent.taskRootHints.length === 0) return false;
  return jsonTasks.some((task) => isTaskExplicitlyMentioned(task, taskIntent));
}

export function shouldSkipMarkdownTaskDiscovery(
  cwd: string,
  jsonTasks: readonly ImportedTaskSummary[],
  taskIntent: TaskIntent | null
): boolean {
  if (!taskIntent?.taskScopeMentioned) return false;
  if (taskIntent.mentionedPlanPaths.length > 0) return false;
  const promptScopedJsonRoute = resolvePromptScopedTaskRoute(cwd, jsonTasks, taskIntent);
  return Boolean(promptScopedJsonRoute && promptScopedJsonRoute.selectedTasks.length > 0);
}

function selectImportedTaskForPromptScope(
  selectedTaskPool: readonly ImportedTaskSummary[],
  isActiveQueue: boolean,
  explicitSingleTaskRoute: boolean,
  statusById: ReadonlyMap<string, string>,
  cwd: string
): ImportedTaskSummary | null {
  if (isActiveQueue || explicitSingleTaskRoute) {
    return selectedTaskPool[0] ?? null;
  }
  return selectedTaskPool.find((task) => areTaskDependenciesSatisfied(task, statusById, cwd)) ?? null;
}

function isSelectedTaskClaimableForIntent(task: ImportedTaskSummary, claimIntent: NextClaimIntent) {
  const status = normalizeTaskRouteStatus(task.status);
  if (canTaskBePreparedForClaim(status)) return true;
  return status === 'review' && claimIntent === 'closeout-only';
}

function hasPromptScopedWorkItems(importedTaskQueue: ImportedTaskQueue) {
  return importedTaskQueue.tasks.some((task) => task.workItemId !== bootstrapTaskId);
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


export function resolvePromptScopedTaskContext(cwd: string, input: { readonly prompt?: string | null; readonly intentPath?: string | null }): PromptScopedTaskContext {
  const taskIntent = resolveTaskIntent(cwd, {
    prompt: normalizeOptionalString(input.prompt) ?? undefined,
    intentPath: normalizeOptionalString(input.intentPath) ?? undefined
  });
  const importedTaskQueue = inspectImportedTaskQueue(cwd, taskIntent);
  return {
    taskIntent: taskIntent ? {
      userPrompt: taskIntent.userPrompt,
      explicitTaskIds: taskIntent.explicitTaskIds,
      taskScopeMentioned: taskIntent.taskScopeMentioned,
      requestedAction: taskIntent.requestedAction,
      source: taskIntent.source
    } : null,
    promptScope: importedTaskQueue.promptScope ? {
      status: importedTaskQueue.promptScope.status,
      selectedTasks: importedTaskQueue.promptScope.selectedTasks,
      targetRepo: importedTaskQueue.promptScope.targetRepo,
      diagnostics: importedTaskQueue.promptScope.diagnostics
    } : null
  };
}

function resolveTaskIntent(cwd: string, input: { readonly prompt?: string; readonly intentPath?: string; readonly explicitTaskIds?: readonly string[] }): TaskIntent | null {
  const cliExplicitTaskIds = uniqueInOrder(input.explicitTaskIds ?? []);
  const fileIntent = input.intentPath ? readTaskIntentFile(cwd, input.intentPath) : null;
  if (fileIntent) {
    const explicitTaskIds = uniqueInOrder([...cliExplicitTaskIds, ...fileIntent.explicitTaskIds]);
    return {
      ...fileIntent,
      userPrompt: input.prompt ?? fileIntent.userPrompt,
      explicitTaskIds,
      taskScopeMentioned: fileIntent.taskScopeMentioned || explicitTaskIds.length > 0
    };
  }
  if (input.prompt && input.prompt.trim().length > 0) {
    return createDeterministicTaskIntent(input.prompt, cliExplicitTaskIds);
  }
  if (cliExplicitTaskIds.length > 0) return createDeterministicTaskIntent(cliExplicitTaskIds.join(','), cliExplicitTaskIds);
  return null;
}

function readTaskIntentFile(cwd: string, intentPath: string): TaskIntent {
  const absolutePath = path.isAbsolute(intentPath) ? intentPath : path.join(cwd, intentPath);
  const parsed = parseJsonText(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
  if (parsed.schemaId !== 'atm.taskIntent.v1') {
    throw new CliError('ATM_TASK_INTENT_SCHEMA_INVALID', 'next --intent requires schemaId atm.taskIntent.v1.', {
      exitCode: 2,
      details: { intentPath }
    });
  }
  return normalizeTaskIntent(parsed, 'atm-skill');
}

function findActiveTaskQueueForIntent(cwd: string, intent: TaskIntent | null, options: {
  readonly sourcePromptFallback?: string | null;
  readonly taskId?: string | null;
} = {}): TaskQueueRecord | null {
  if (intent?.userPrompt) {
    const exact = findActiveTaskQueue(cwd, intent.userPrompt);
    if (exact) return exact;
  }
  if (options.sourcePromptFallback) {
    const fallback = findActiveTaskQueue(cwd, options.sourcePromptFallback);
    if (fallback) return fallback;
  }
  for (const scopeKey of deriveBatchScopeKeysFromIntent(intent)) {
    const scoped = findActiveTaskQueue(cwd, null, { scopeKey });
    if (scoped) return scoped;
  }
  if (options.taskId) {
    const byTask = findActiveTaskQueue(cwd, null, { taskId: options.taskId });
    if (byTask) return byTask;
  }
  return null;
}

function reconcilePromptScopeRuntimeForClaim(
  cwd: string,
  taskIntent: TaskIntent | null,
  selectedTasks: readonly ImportedTaskSummary[]
) {
  const sourcePrompt = taskIntent?.userPrompt?.trim() ?? '';
  if (!sourcePrompt || selectedTasks.length === 0) return null;
  const existingQueue = findActiveTaskQueueForIntent(cwd, taskIntent, {
    taskId: selectedTasks[0]?.workItemId ?? null
  });
  const refreshedQueue = createOrRefreshTaskQueue({
    cwd,
    sourcePrompt,
    tasks: selectedTasks,
    taskIds: selectedTasks.map((task) => task.workItemId),
    actorId: null,
    batchId: existingQueue?.batchId ?? null,
    scopeKey: existingQueue?.scopeKey ?? null
  });
  if (existingQueue && existingQueue.queueId !== refreshedQueue.queueId && existingQueue.status === 'active') {
    abandonTaskQueue({
      cwd,
      queueId: existingQueue.queueId,
      actorId: 'atm-runtime-reconcile',
      reason: `superseded by dependency-refreshed prompt queue ${refreshedQueue.queueId}`
    });
  }
  const queueHeadTaskId = refreshedQueue.taskIds[refreshedQueue.currentIndex] ?? null;
  const queueHeadTask = queueHeadTaskId
    ? selectedTasks.find((task) => task.workItemId === queueHeadTaskId) ?? null
    : null;
  const activeBatch = refreshedQueue.batchId
    ? readActiveBatchRun(cwd, { batchId: refreshedQueue.batchId })
    : findActiveBatchRunForIntent(cwd, taskIntent, { taskId: queueHeadTaskId });
  const batchRun = activeBatch?.status === 'active'
    ? repairBatchRunFromQueue(cwd, activeBatch, refreshedQueue)
    : null;
  return {
    queue: refreshedQueue,
    batchRun,
    queueHeadTask
  };
}

function findActiveBatchRunForIntent(cwd: string, intent: TaskIntent | null, options: {
  readonly sourcePromptFallback?: string | null;
  readonly taskId?: string | null;
} = {}) {
  if (intent?.userPrompt) {
    const exact = readActiveBatchRun(cwd, { sourcePrompt: intent.userPrompt });
    if (exact) return exact;
  }
  if (options.sourcePromptFallback) {
    const fallback = readActiveBatchRun(cwd, { sourcePrompt: options.sourcePromptFallback });
    if (fallback) return fallback;
  }
  for (const scopeKey of deriveBatchScopeKeysFromIntent(intent)) {
    const scoped = readActiveBatchRun(cwd, { scopeKey });
    if (scoped) return scoped;
  }
  if (options.taskId) {
    const byTask = readActiveBatchRun(cwd, { taskId: options.taskId });
    if (byTask) return byTask;
  }
  return null;
}

function deriveBatchScopeKeysFromIntent(intent: TaskIntent | null): readonly string[] {
  if (!intent) return [];
  const roots = [
    ...intent.taskRootHints,
    ...intent.mentionedTaskIds
      .map((taskId) => taskId.match(/^(.+?)-\d{2,}(?:-.+)?$/)?.[1] ?? null)
      .filter((entry): entry is string => Boolean(entry))
  ];
  return uniqueSorted(roots.flatMap((root) => normalizeRootHintScopeKeys(root)));
}

function normalizeRootHintScopeKeys(root: string): readonly string[] {
  const normalized = root.trim().toUpperCase().replace(/_/g, '-');
  if (!normalized) return [];
  if (normalized.startsWith('TASK-')) return [normalized];
  if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(normalized)) {
    return [`TASK-${normalized}`];
  }
  return [normalized];
}

function createDeterministicTaskIntent(prompt: string, explicitTaskIds: readonly string[] = []): TaskIntent {
  const mentionedTaskIds = uniqueSorted(extractTaskIdReferencesFromPrompt(prompt).flatMap((entry) => expandTaskIdReferenceAliases(entry)));
  const mentionedPlanPaths = uniqueSorted(extractPromptPathHints(prompt).filter((entry) => /\.md$/i.test(entry)));
  const targetRepoHints = uniqueSorted([
    ...(/AI-Atomic-Framework|ATM\s*framework|ATM\s*\u6846\u67b6|ATM\u6846\u67b6|\u539f\u5b50\u6846\u67b6/i.test(prompt) ? ['AI-Atomic-Framework'] : [])
  ]);
  const taskRootHints = uniqueSorted([
    ...(/self[-_ ]?atomization|\u81ea\u6211\u539f\u5b50\u5316|100%/i.test(prompt) ? ['atm-self-atomization'] : []),
    ...extractTaskFamilyRootHintsFromPrompt(prompt),
    ...extractTaskRootHintsFromPrompt(prompt, mentionedTaskIds),
    ...extractPromptPathHints(prompt).filter((entry) => !/\.md$/i.test(entry))
  ]);
  const ordinalScope = /\u524d\s*(?:3|\u4e09)\s*\u5f35|first\s+3/i.test(prompt)
    ? { kind: 'first' as const, count: 3 }
    : /\u524d\s*(?:2|\u5169|\u4e8c)\s*\u5f35|first\s+2/i.test(prompt)
      ? { kind: 'first' as const, count: 2 }
      : null;
  const queueRequested = isQueueRequestedPrompt(prompt) || Boolean(ordinalScope);
  const orderedExplicitTaskIds = uniqueInOrder(explicitTaskIds.map((entry) => entry.toUpperCase()));
  const taskScopeMentioned = orderedExplicitTaskIds.length > 0
    || mentionedTaskIds.length > 0
    || mentionedPlanPaths.length > 0
    || taskRootHints.length > 0
    || queueRequested
    || /\u4efb\u52d9\u5361|task\s*card|task[-_ ]?asa|\u8a08\u756b\u66f8/i.test(prompt);
  return {
    schemaId: 'atm.taskIntent.v1',
    userPrompt: prompt,
    explicitTaskIds: orderedExplicitTaskIds,
    mentionedTaskIds,
    mentionedPlanPaths,
    taskRootHints,
    targetRepoHints,
    requestedAction: detectRequestedTaskAction(prompt),
    confidence: orderedExplicitTaskIds.length > 0 ? 0.98 : taskScopeMentioned ? 0.7 : 0.25,
    source: 'cli-deterministic',
    ordinalScope,
    queueRequested,
    taskScopeMentioned
  };
}


function resolvePromptScopedTaskRoute(
  cwd: string,
  tasks: readonly ImportedTaskSummary[],
  taskIntent: TaskIntent | null,
  planningRootResolution?: ReturnType<typeof resolveCandidatePlanningRoots>
): PromptScopedTaskRoute | null {
  if (!taskIntent || !taskIntent.taskScopeMentioned) return null;
  if (taskIntent.explicitTaskIds.length > 0) {
    const selectedTasks = taskIntent.explicitTaskIds
      .map((taskId) => findTaskByTaskIdReference(tasks, taskId))
      .filter((task): task is ImportedTaskSummary => Boolean(task));
    const missingTaskIds = taskIntent.explicitTaskIds.filter((taskId) => !findTaskByTaskIdReference(selectedTasks, taskId));
    if (missingTaskIds.length > 0) {
      return {
        status: 'not-found',
        selectedTasks,
        targetRepo: resolveRouteTargetRepo(selectedTasks),
        diagnostics: ['explicit-task-range-missing-task-ids', `missing:${missingTaskIds.join(',')}`]
      };
    }
    return {
      status: selectedTasks.length > 1 ? 'queue' : 'ready',
      selectedTasks,
      targetRepo: resolveRouteTargetRepo(selectedTasks),
      diagnostics: ['explicit-task-range']
    };
  }
  const scored = tasks
    .map((task) => scoreTaskForIntent(cwd, task, taskIntent))
    .filter((task) => (task.matchScore ?? 0) > 0)
    .sort(compareScoredTasks);
  const hasExplicitScopeHints = taskIntent.mentionedTaskIds.length > 0
    || taskIntent.mentionedPlanPaths.length > 0
    || taskIntent.taskRootHints.length > 0
    || taskIntent.targetRepoHints.length > 0;
  const viableMatches = hasExplicitScopeHints
    ? scored.filter((task) => hasRequiredPromptScopeMatch(task, taskIntent))
    : scored;
  if (viableMatches.length === 0) {
    if (
      taskIntent.taskRootHints.some((hint) => hint.startsWith('TASK-'))
      && (
      taskIntent.mentionedTaskIds.length === 0
      && taskIntent.mentionedPlanPaths.length === 0
      && taskIntent.taskRootHints.length > 0
      && (taskIntent.queueRequested || taskIntent.ordinalScope !== null || taskIntent.requestedAction === 'close')
      )
    ) {
      return {
        status: 'empty',
        selectedTasks: [],
        targetRepo: null,
        diagnostics: ['prompt-task-scope-had-no-open-imported-work']
      };
    }
    return {
      status: 'not-found',
      selectedTasks: [],
      targetRepo: null,
      diagnostics: ['prompt-task-scope-had-no-matching-task-card']
    };
  }
  if (viableMatches.every(isTaskCardSurfaceOnlyMatch)) {
    if (looksLikeNamedPlanPrompt(taskIntent.userPrompt ?? '')) {
      return {
        status: 'not-found',
        selectedTasks: [],
        targetRepo: null,
        diagnostics: ['low-confidence-task-card-surface-rejected', 'named-plan-prompt-had-no-matching-plan-tasks']
      };
    }
    return {
      status: 'ambiguous',
      selectedTasks: viableMatches.slice(0, 12),
      targetRepo: resolveRouteTargetRepo(viableMatches),
      diagnostics: ['low-confidence-task-card-surface-selection-required']
    };
  }
  const scoped = applyOrdinalScope(viableMatches, taskIntent);
  const selectedTasks = taskIntent.queueRequested || taskIntent.ordinalScope ? scoped : scoped.slice(0, 1);
  if (taskIntent.queueRequested || taskIntent.ordinalScope) {
    return {
      status: 'queue',
      selectedTasks,
      targetRepo: resolveRouteTargetRepo(selectedTasks),
      diagnostics: [`scoped-queue-size:${selectedTasks.length}`]
    };
  }
  const bestScore = viableMatches[0]?.matchScore ?? 0;
  const topMatches = viableMatches.filter((task) => (task.matchScore ?? 0) === bestScore);
  const exactTaskIdRequested = taskIntent.mentionedTaskIds.length > 0;
  if (topMatches.length === 1 && (exactTaskIdRequested || bestScore >= 60)) {
    return {
      status: 'ready',
      selectedTasks: [topMatches[0]],
      targetRepo: topMatches[0].targetRepo,
      diagnostics: topMatches[0].matchReasons ?? []
    };
  }
  return {
    status: 'ambiguous',
    selectedTasks: viableMatches.slice(0, 12),
    targetRepo: resolveRouteTargetRepo(viableMatches),
    diagnostics: ['multiple-task-candidates-matched-prompt']
  };
}

function findTaskByTaskIdReference(tasks: readonly ImportedTaskSummary[], taskIdReference: string): ImportedTaskSummary | null {
  const aliases = expandTaskIdReferenceAliases(taskIdReference);
  return tasks.find((task) => aliases.includes(task.workItemId.toUpperCase())) ?? null;
}

function assertPromptBatchDoesNotConflict(input: {
  readonly cwd: string;
  readonly promptScope: PromptScopedTaskRoute | null;
  readonly allTasks: readonly ImportedTaskSummary[];
  readonly sourcePrompt: string | null;
  readonly currentBatchId?: string | null;
}) {
  if (input.promptScope?.status !== 'queue') return;
  const requestedTaskIds = input.promptScope.selectedTasks.map((task) => task.workItemId);
  const requestedAllowedFiles = uniqueSorted(input.promptScope.selectedTasks.flatMap((task) => task.targetAllowedFiles));
  const sourcePromptHash = input.sourcePrompt?.trim() ? sha256(input.sourcePrompt.trim()) : null;
  const activeBatches = listActiveBatchRuns(input.cwd);
  for (const batchRun of activeBatches) {
    if (input.currentBatchId && batchRun.batchId === input.currentBatchId) continue;
    if (sourcePromptHash && batchRun.sourcePromptHash === sourcePromptHash) continue;
    const overlappingTaskIds = requestedTaskIds.filter((taskId) => batchRun.taskIds.includes(taskId));
    if (overlappingTaskIds.length > 0) {
      throw new CliError('ATM_BATCH_TASK_OWNERSHIP_CONFLICT', 'A task cannot belong to two active batch runs. Abandon or finish the existing batch before creating another one for the same task.', {
        exitCode: 1,
        details: {
          batchId: batchRun.batchId,
          scopeKey: batchRun.scopeKey,
          overlappingTaskIds,
          requiredCommand: `node atm.mjs batch status --batch ${batchRun.batchId} --json`
        }
      });
    }
    const batchTasks = batchRun.taskIds
      .map((taskId) => input.allTasks.find((task) => task.workItemId === taskId))
      .filter((task): task is ImportedTaskSummary => Boolean(task));
    const batchAllowedFiles = uniqueSorted(batchTasks.flatMap((task) => task.targetAllowedFiles));
    const overlappingFiles = requestedAllowedFiles.filter((file) => isPathAllowedByScope(file, batchAllowedFiles));
    if (overlappingFiles.length > 0) {
      throw new CliError('ATM_BATCH_FILE_CONFLICT', 'Another active batch already owns one or more target files for this batch range.', {
        exitCode: 1,
        details: {
          conflictingBatchId: batchRun.batchId,
          conflictingScopeKey: batchRun.scopeKey,
          conflictingTaskIds: batchRun.taskIds,
          overlappingFiles,
          requiredAction: `Run node atm.mjs batch status --batch ${batchRun.batchId} --json, then checkpoint/commit or abandon that batch before claiming this overlapping range.`
        }
      });
    }
  }
}



function scoreTaskForIntent(cwd: string, task: ImportedTaskSummary, intent: TaskIntent): ImportedTaskSummary {
  const prompt = normalizeSearchText(intent.userPrompt ?? '');
  const reasons: string[] = [];
  let score = 0;
  if (intent.mentionedTaskIds.includes(task.workItemId.toUpperCase())) {
    score += 120;
    reasons.push('task-id-exact');
  }
  const pathFields = [
    task.taskPath,
    task.sourcePlanPath,
    ...task.nearbyPlanPaths
  ].filter((entry): entry is string => Boolean(entry));
  for (const planHint of intent.mentionedPlanPaths) {
    if (pathFields.some((field) => pathFieldMatches(field, planHint))) {
      score += 90;
      reasons.push('plan-path-match');
      break;
    }
  }
  for (const field of pathFields) {
    const normalizedField = normalizeSearchText(field);
    const stem = normalizeSearchText(path.basename(field).replace(/\.[^.]+$/, ''));
    if ((normalizedField && prompt.includes(normalizedField)) || (stem && prompt.includes(stem))) {
      score += 85;
      reasons.push('nearby-plan-name-match');
      break;
    }
  }
  for (const rootHint of intent.taskRootHints) {
    const normalizedHint = normalizeSearchText(rootHint);
    if (normalizedHint && (
      normalizeSearchText(task.workItemId).includes(normalizedHint)
      || pathFields.some((field) => normalizeSearchText(field).includes(normalizedHint))
    )) {
      score += 65;
      reasons.push('task-root-hint-match');
      break;
    }
  }
  if (intent.targetRepoHints.length > 0 && task.targetRepo) {
    const target = normalizeSearchText(task.targetRepo);
    if (intent.targetRepoHints.some((hint) => target.includes(normalizeSearchText(hint)))) {
      score += 35;
      reasons.push('target-repo-match');
    }
  }
  const normalizedTitle = normalizeSearchText(task.title);
  if (normalizedTitle && prompt.includes(normalizedTitle)) {
    score += 60;
    reasons.push('title-exact');
  } else {
    const overlap = countTokenOverlap(prompt, task.title);
    if (overlap >= 2) {
      score += Math.min(30, overlap * 8);
      reasons.push('title-token-overlap');
    }
  }
  if (/(?:\u4efb\u52d9\u5361|task\s*card)/i.test(intent.userPrompt ?? '') && /\.task\.md$/i.test(task.taskPath)) {
    score += 10;
    reasons.push('task-card-surface');
  }
  if (task.taskPath && isTaskPathUnderPreferredPlanningRoots(cwd, task.taskPath)) {
    score += 15;
    reasons.push('canonical-planning-root');
  }
  return {
    ...task,
    matchScore: score,
    matchReasons: reasons
  };
}

function applyOrdinalScope(tasks: readonly ImportedTaskSummary[], intent: TaskIntent): readonly ImportedTaskSummary[] {
  const planScoped = tasks.filter((task) => (task.matchReasons ?? []).some((reason) => reason.includes('plan') || reason.includes('root') || reason.includes('task-id')));
  const source = planScoped.length > 0 ? planScoped : tasks;
  if (!intent.ordinalScope) return source;
  return [...source]
    .sort((left, right) => left.workItemId.localeCompare(right.workItemId))
    .slice(0, intent.ordinalScope.count);
}



function resolveRouteTargetRepo(tasks: readonly ImportedTaskSummary[]): string | null {
  const targets = uniqueSorted(tasks.map((task) => task.targetRepo).filter((entry): entry is string => Boolean(entry)));
  return targets.length === 1 ? targets[0] : null;
}

function extractTaskRootHintsFromPrompt(prompt: string, mentionedTaskIds: readonly string[]): readonly string[] {
  const directRoots = (prompt.match(/\b[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)+\b/g) ?? [])
    .map((entry) => entry.toUpperCase())
    .filter((entry) => !/\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/.test(entry));
  const derivedRoots = mentionedTaskIds
    .map((taskId) => taskId.match(/^(.*)-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/)?.[1] ?? null)
    .filter((entry): entry is string => Boolean(entry));
  return uniqueSorted([...directRoots, ...derivedRoots]);
}

function extractTaskIdReferencesFromPrompt(prompt: string): readonly string[] {
  const references = new Set<string>();
  for (const match of prompt.matchAll(/\b(?:TASK-|ATM-)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*\b/gi)) {
    references.add(match[0].toUpperCase());
  }
  for (const match of prompt.matchAll(/\b((?:TASK-|ATM-)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*)-(\d{2,})((?:\s*[\/,]\s*\d{2,})+)/gi)) {
    const prefix = match[1]?.toUpperCase();
    const firstNumber = match[2] ?? '';
    const suffix = match[3] ?? '';
    if (!prefix || !firstNumber) continue;
    for (const numberMatch of suffix.matchAll(/\d{2,}/g)) {
      const number = numberMatch[0]?.padStart(firstNumber.length, '0');
      if (number) references.add(`${prefix}-${number}`);
    }
  }
  return [...references].sort((left, right) => left.localeCompare(right));
}

function expandTaskIdReferenceAliases(taskIdReference: string): readonly string[] {
  const normalized = taskIdReference
    .trim()
    .toUpperCase()
    .replace(/_/g, '-')
    .replace(/^[`"'(]+|[`"'):;,]+$/g, '');
  if (!normalized) return [];
  const aliases = new Set<string>([normalized]);
  if (normalized.startsWith('TASK-')) {
    aliases.add(normalized.slice('TASK-'.length));
  } else if (/^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*$/.test(normalized)) {
    aliases.add(`TASK-${normalized}`);
  }
  return [...aliases];
}

function extractTaskFamilyRootHintsFromPrompt(prompt: string): readonly string[] {
  const ignoredCodes = new Set(['AI', 'API', 'ATM', 'CLI', 'CPU', 'CSS', 'GIT', 'HTML', 'HTTP', 'JSON', 'MD', 'NPM', 'SDK', 'TASK', 'TS', 'UI']);
  const output = new Set<string>();
  for (const match of prompt.matchAll(/\b([A-Z][A-Z0-9]{1,9})\b/g)) {
    const code = match[1]?.toUpperCase();
    if (!code || ignoredCodes.has(code)) continue;
    const index = match.index ?? 0;
    const context = prompt.slice(Math.max(0, index - 30), Math.min(prompt.length, index + code.length + 40));
    if (/(?:\u7cfb\u5217|\u4efb\u52d9\u5361|\u4efb\u52d9|\u5f8c\u9762|\u5f8c\u7e8c|\u5269\u9918|\u63a5\u4e0b\u4f86|\u9010\u4e00|task\s*cards?|tasks?|task\s*family|family|remaining|next|later)/i.test(context)) {
      output.add(`TASK-${code}`);
    }
  }
  return [...output].sort((left, right) => left.localeCompare(right));
}

function dedupeTasks(tasks: readonly ImportedTaskSummary[]): readonly ImportedTaskSummary[] {
  const seen = new Set<string>();
  const output: ImportedTaskSummary[] = [];
  for (const task of tasks) {
    const key = task.workItemId;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(task);
  }
  return output;
}

// Harmless comment for TASK-AAO-0120 deliverable check 3
interface ImportedTaskSummaryWithOutOfScope extends ImportedTaskSummary {
  readonly outOfScope?: readonly string[];
}

function finalizeImportedTaskSummary(task: Omit<ImportedTaskSummary, 'planningReadOnlyPaths' | 'planningMirrorPaths' | 'targetAllowedFiles'> & { readonly outOfScope?: readonly string[] }, cwd?: string): ImportedTaskSummaryWithOutOfScope {
  const partition = partitionTaskScope(task, cwd ? { cwd } : undefined);
  return {
    ...task,
    planningReadOnlyPaths: partition.planningContext.readOnlyPaths,
    planningMirrorPaths: partition.targetWork.planningMirrorPaths,
    targetAllowedFiles: partition.targetWork.allowedFiles
  };
}

function withMirrorSyncOnlyTarget<T extends ImportedTaskSummary>(task: T): T {
  return {
    ...task,
    targetAllowedFiles: []
  };
}

function withMirrorSyncOnlyTargetQueue(queue: ImportedTaskQueue, taskId: string): ImportedTaskQueue {
  const rewrite = (task: ImportedTaskSummary) => task.workItemId === taskId ? withMirrorSyncOnlyTarget(task) : task;
  return {
    ...queue,
    selectedTask: queue.selectedTask ? rewrite(queue.selectedTask) : queue.selectedTask,
    claimableTask: queue.claimableTask && queue.claimableTask.workItemId === taskId ? null : queue.claimableTask,
    tasks: queue.tasks.map(rewrite),
    promptScope: queue.promptScope
      ? {
        ...queue.promptScope,
        selectedTasks: queue.promptScope.selectedTasks.map(rewrite)
      }
      : queue.promptScope
  };
}

function extractDeclaredTaskPathsFromDocument(taskDocument: Record<string, unknown>) {
  const files = new Set<string>();
  for (const key of ['scope', 'files', 'changedFiles', 'criticalChangedFiles', 'guardPaths', 'targetFiles', 'deliverables', 'artifacts']) {
    collectDeclaredTaskPathValues(taskDocument[key], files);
  }
  const source = taskDocument.source;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    const sourceRecord = source as Record<string, unknown>;
    collectDeclaredTaskPathValues(sourceRecord.path, files);
    collectDeclaredTaskPathValues(sourceRecord.planPath, files);
  }
  for (const key of ['notes', 'summary', 'description', 'acceptance']) {
    collectDeclaredTaskPathValues(taskDocument[key], files);
  }
  return [...files].sort((left, right) => left.localeCompare(right));
}

function extractLinkedSourceTaskArtifactPaths(cwd: string, sourcePlanPath: string | null) {
  if (!sourcePlanPath) return [];
  const absolutePlanPath = path.isAbsolute(sourcePlanPath) ? sourcePlanPath : path.resolve(cwd, sourcePlanPath);
  if (!existsSync(absolutePlanPath)) return [];
  try {
    return extractTaskArtifactPathsFromMarkdown(cwd, readFileSync(absolutePlanPath, 'utf8'));
  } catch {
    return [];
  }
}

function collectDeclaredTaskPathValues(value: unknown, files: Set<string>) {
  if (typeof value === 'string') {
    const normalized = normalizeOptionalTaskPath(value);
    if (normalized && isTaskDirectionPathCandidate(normalized)) {
      files.add(normalized);
    }
    for (const candidate of extractPathLikeStringsFromText(value)) {
      files.add(candidate);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectDeclaredTaskPathValues(entry, files);
    }
  }
}

function extractTaskArtifactPathsFromMarkdown(cwd: string, text: string) {
  return uniqueSorted([
    ...extractPathLikeStringsFromText(text),
    ...resolveBareArtifactPathCandidates(cwd, extractBareArtifactFileNames(text)),
    ...extractCommandSurfacePathsFromMarkdown(text)
  ]);
}

function extractPathLikeStringsFromText(text: string) {
  const candidates = new Set<string>();
  const matches = text.matchAll(/\b(?:\.atm|docs|atomic_workbench|packages|scripts|schemas|specs|templates|integrations|examples|tests|release|\.github|\.claude|\.cursor|\.gemini)(?:\/[A-Za-z0-9._-]+)+\b|\b(?:atm\.mjs|package(?:-lock)?\.json|tsconfig(?:\.[A-Za-z0-9._-]+)?\.json)\b/g);
  for (const match of matches) {
    const normalized = normalizeOptionalTaskPath(match[0]);
    if (normalized) {
      candidates.add(normalized);
    }
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

function extractBareArtifactFileNames(text: string) {
  const candidates = new Set<string>();
  const matches = text.matchAll(/(?:^|[\s`"'([>-])([A-Za-z0-9][A-Za-z0-9._-]*\.(?:json|jsonl|md|csv|tsv|txt|ya?ml|html|xml))(?:$|[\s`"')\]<,.;:])/gmi);
  for (const match of matches) {
    const fileName = match[1]?.trim();
    if (!fileName || fileName.includes('/') || fileName.includes('\\')) continue;
    if (fileName.length > 120) continue;
    candidates.add(fileName);
  }
  return [...candidates].sort((left, right) => left.localeCompare(right));
}

function resolveBareArtifactPathCandidates(cwd: string, fileNames: readonly string[]) {
  if (fileNames.length === 0) return [];
  const output = new Set<string>();
  const knownArtifactFiles = listKnownArtifactFiles(cwd);
  const artifactFilesByBasename = new Map<string, string[]>();
  for (const artifactPath of knownArtifactFiles) {
    const key = path.basename(artifactPath).toLowerCase();
    const existing = artifactFilesByBasename.get(key) ?? [];
    existing.push(artifactPath);
    artifactFilesByBasename.set(key, existing);
  }

  for (const fileName of fileNames) {
    for (const candidateName of artifactFileNameVariants(fileName)) {
      for (const existingPath of artifactFilesByBasename.get(candidateName.toLowerCase()) ?? []) {
        output.add(existingPath);
      }
      const atomizationCoveragePath = resolveAtomizationCoverageArtifactPath(candidateName);
      if (atomizationCoveragePath) {
        output.add(atomizationCoveragePath);
      }
    }
  }
  return [...output].sort((left, right) => left.localeCompare(right));
}

function listKnownArtifactFiles(cwd: string) {
  const roots = [
    'atomic_workbench',
    'artifacts',
    'docs',
    'fixtures',
    'reports',
    'schemas'
  ];
  return uniqueSorted(roots.flatMap((root) => {
    const absoluteRoot = path.join(cwd, root);
    return listFilesRecursive(absoluteRoot, (filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      return ['.json', '.jsonl', '.md', '.csv', '.tsv', '.txt', '.yaml', '.yml'].includes(ext);
    }).map((filePath) => path.relative(cwd, filePath).replace(/\\/g, '/'));
  }));
}

function artifactFileNameVariants(fileName: string) {
  const variants = new Set<string>();
  const normalized = fileName.trim();
  if (!normalized) return [];
  variants.add(normalized);
  if (normalized.startsWith('atm-')) {
    variants.add(normalized.slice('atm-'.length));
  }
  return [...variants].sort((left, right) => left.localeCompare(right));
}

function resolveAtomizationCoverageArtifactPath(fileName: string) {
  const basename = path.basename(fileName);
  const atomizationCoverageArtifacts = new Set([
    'dogfood-score.json',
    'dogfood-score.md',
    'exclusion-inventory.json',
    'generated-fixture-boundaries.json',
    'path-to-atom-map.json',
    'manifest.json'
  ]);
  if (!atomizationCoverageArtifacts.has(basename)) return null;
  if (basename === 'manifest.json') {
    return 'atomic_workbench/atomization-coverage/path-to-atom-map-shards/manifest.json';
  }
  return `atomic_workbench/atomization-coverage/${basename}`;
}

function extractCommandSurfacePathsFromMarkdown(text: string) {
  const paths = new Set<string>();
  for (const match of text.matchAll(/\bnode\s+atm\.mjs\s+(guard|validate)\s+([a-z][a-z0-9-]*)\b/gi)) {
    const command = match[1]?.toLowerCase();
    const topic = match[2]?.toLowerCase();
    if (command === 'guard') {
      paths.add('packages/cli/src/commands/guard.ts');
    }
    if (command === 'validate') {
      paths.add('packages/cli/src/commands/validate.ts');
      addValidateTopicPaths(paths, topic);
    }
  }
  for (const match of text.matchAll(/\bnpm\s+run\s+validate:([a-z][a-z0-9-]*)\b/gi)) {
    addValidateTopicPaths(paths, match[1]?.toLowerCase());
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function addValidateTopicPaths(paths: Set<string>, topic: string | undefined) {
  if (!topic) return;
  paths.add('package.json');
  paths.add(`scripts/validate-${topic}.ts`);
}

function resolveQuickfixScope(prompt: string) {
  return uniqueSorted([
    ...extractPathLikeStringsFromText(prompt),
    ...extractPathLikeStringsFromPrompt(prompt)
  ]);
}


interface PendingTaskArtifactScopeDiagnostic {
  readonly schemaId: 'atm.taskArtifactScopeDiagnostic.v1';
  readonly ignoredUntrackedFiles: readonly string[];
  readonly advisoryTrackedFiles: readonly string[];
}

/**
 * TASK-AAO-0011: claim/checkpoint must not hard-block on unrelated untracked
 * files (e.g. an unrelated svg in `docs/assets/`, a peer agent's WIP, screenshots,
 * tmp patches). Untracked candidates are demoted to a warning surfaced via
 * `ignoredUntrackedFiles`; the claim still produces a valid direction lock.
 *
 * The hard-block path remains for STAGED or MODIFIED-TRACKED files that look
 * like a deliverable for this task but live outside its allowedFiles — those
 * are the real "scope expansion required" cases that demand
 * `tasks scope --add` instead of editing runtime locks.
 */
function checkPendingTaskArtifactScopeExpansion(input: {
  readonly cwd: string;
  readonly task: ImportedTaskSummary;
}): PendingTaskArtifactScopeDiagnostic {
  const allowedFiles = buildAllowedFilesForTask(input.task);
  const { stagedOrTracked, untracked } = listPendingGitFilesByKind(input.cwd);
  const foreignDirectionLocks = readActiveTaskDirectionLocks(input.cwd)
    .filter((lock) => lock.taskId !== input.task.workItemId);
  const outsideScope = (entry: string) =>
    !entry.startsWith('.atm/') && !isPathAllowedByScope(entry, allowedFiles);
  const isAdvisoryOutsideScopePath = (entry: string) =>
    isAdvisoryPendingTaskArtifactPath(entry)
    || foreignDirectionLocks.some((lock) => isPathAllowedByScope(entry, lock.allowedFiles));

  const advisoryTrackedFiles = stagedOrTracked
    .filter(outsideScope)
    .filter(isAdvisoryOutsideScopePath);
  const stagedExpansion = stagedOrTracked
    .filter(outsideScope)
    .filter((entry) => !isAdvisoryOutsideScopePath(entry))
    .filter((entry) => looksLikeTaskArtifact(entry, input.task));
  const untrackedExpansion = untracked
    .filter(outsideScope)
    .filter((entry) => !isAdvisoryOutsideScopePath(entry))
    .filter((entry) => looksLikeTaskArtifact(entry, input.task));

  if (stagedExpansion.length > 0) {
    throw new CliError(
      'ATM_TASK_SCOPE_EXPANSION_REQUIRED',
      `Task ${input.task.workItemId} has staged or modified deliverable-like files outside targetWork.allowedFiles; update the task scope/deliverables instead of editing runtime locks.`,
      {
        exitCode: 1,
        details: {
          taskId: input.task.workItemId,
          outsideAllowedFiles: stagedExpansion,
          advisoryTrackedFiles,
          ignoredUntrackedFiles: untrackedExpansion,
          allowedFiles,
          requiredAction: 'Add these real deliverables to the task card frontmatter scope/deliverables (then re-import) or run `node atm.mjs tasks scope --add <paths>`; do not edit runtime locks.',
          notAllowed: 'Do not edit .atm/runtime/locks/** or task direction lock JSON to bypass this scope mismatch.'
        }
      }
    );
  }

  return {
    schemaId: 'atm.taskArtifactScopeDiagnostic.v1',
    ignoredUntrackedFiles: untrackedExpansion,
    advisoryTrackedFiles
  };
}

function isAdvisoryPendingTaskArtifactPath(filePath: string): boolean {
  const normalized = normalizeOptionalTaskPath(filePath)?.replace(/\\/g, '/') ?? '';
  if (!normalized) return false;
  return normalized === 'atomic_workbench/atomization-coverage/path-to-atom-map.json'
    || normalized.startsWith('release/atm-root-drop/')
    || normalized.startsWith('release/atm-onefile/');
}

function listPendingGitFilesByKind(cwd: string): {
  readonly stagedOrTracked: readonly string[];
  readonly untracked: readonly string[];
} {
  const collect = (args: readonly string[]) => {
    const result = spawnSync('git', args as string[], { cwd, encoding: 'utf8' });
    if (result.status !== 0) return [] as string[];
    return result.stdout
      .split(/\r?\n/)
      .map((entry: string) => normalizeOptionalTaskPath(entry))
      .filter((entry: string | null): entry is string => Boolean(entry));
  };
  const staged = [
    ...collect(['diff', '--name-only', '--cached']),
    ...collect(['diff', '--name-only'])
  ];
  const untracked = collect(['ls-files', '--others', '--exclude-standard']);
  return {
    stagedOrTracked: uniqueSorted(staged),
    untracked: uniqueSorted(untracked)
  };
}

function listPendingGitFiles(cwd: string): readonly string[] {
  const { stagedOrTracked, untracked } = listPendingGitFilesByKind(cwd);
  return uniqueSorted([...stagedOrTracked, ...untracked]);
}

function listIgnoredArtifactCandidates(cwd: string): readonly string[] {
  const artifactRoots = ['artifacts', 'reports', 'atomic_workbench/evidence', 'atomic_workbench/reports'];
  const result = spawnSync('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '--', ...artifactRoots], {
    cwd,
    encoding: 'utf8'
  });
  if (result.status !== 0) return [];
  return uniqueSorted(result.stdout
    .split(/\r?\n/)
    .map((entry: string) => normalizeOptionalTaskPath(entry))
    .filter((entry: string | null): entry is string => Boolean(entry)));
}

function isPromptGeneratedArtifactPath(filePath: string): boolean {
  const normalized = normalizeOptionalTaskPath(filePath)?.replace(/\\/g, '/') ?? '';
  if (!normalized) return false;
  return normalized.startsWith('artifacts/')
    || normalized.startsWith('reports/')
    || normalized.startsWith('atomic_workbench/evidence/')
    || normalized.startsWith('atomic_workbench/reports/');
}

function buildPromptWorktreeHint(cwd: string, prompt: string) {
  const { stagedOrTracked, untracked } = listPendingGitFilesByKind(cwd);
  const ignoredArtifacts = listIgnoredArtifactCandidates(cwd);
  const promptPathHints = extractPathLikeStringsFromText(prompt);
  const promptMatchedFiles = new Set<string>();
  const atmManagedFiles = new Set<string>();
  const generatedArtifactFiles = new Set<string>();
  const releaseMirrorFiles = new Set<string>();
  const unrelatedTrackedFiles = new Set<string>();
  const unrelatedUntrackedFiles = new Set<string>();
  const matchesPromptHint = (filePath: string) => promptPathHints.some((hint) =>
    filePath === hint
    || filePath.startsWith(`${hint}/`)
    || hint.startsWith(`${filePath}/`)
  );

  const classify = (filePath: string, tracked: boolean) => {
    if (matchesPromptHint(filePath)) {
      promptMatchedFiles.add(filePath);
      return;
    }
    if (filePath.startsWith('.atm/')) {
      atmManagedFiles.add(filePath);
      return;
    }
    if (filePath.startsWith('release/')) {
      releaseMirrorFiles.add(filePath);
      return;
    }
    if (isPromptGeneratedArtifactPath(filePath)) {
      generatedArtifactFiles.add(filePath);
      return;
    }
    (tracked ? unrelatedTrackedFiles : unrelatedUntrackedFiles).add(filePath);
  };

  stagedOrTracked.forEach((filePath) => classify(filePath, true));
  untracked.forEach((filePath) => classify(filePath, false));

  return {
    schemaId: 'atm.promptWorktreeHint.v1' as const,
    promptPathHints,
    promptMatchedFiles: uniqueSorted([...promptMatchedFiles]),
    atmManagedFiles: uniqueSorted([...atmManagedFiles]),
    generatedArtifactFiles: uniqueSorted([...generatedArtifactFiles]),
    releaseMirrorFiles: uniqueSorted([...releaseMirrorFiles]),
    unrelatedTrackedFiles: uniqueSorted([...unrelatedTrackedFiles]),
    unrelatedUntrackedFiles: uniqueSorted([...unrelatedUntrackedFiles]),
    ignoredArtifactCount: ignoredArtifacts.length,
    note: 'No task scope is active yet. Prompt-matched files are only hints; every other dirty bucket stays advisory until ATM selects a governed route or task.'
  };
}

function buildIgnoredArtifactForceAddHints(cwd: string) {
  return listIgnoredArtifactCandidates(cwd).map((filePath) => ({
    path: filePath,
    requiredCommand: `git add -f -- ${quoteCliValue(filePath)}`,
    reason: 'This path is currently hidden by .gitignore; use force-add only if it is the intended deliverable for the selected route.'
  }));
}

function buildNonPlaybookRouteHints(cwd: string, prompt: string) {
  return {
    playbookState: 'absent' as const,
    structuredOutputHint: {
      schemaId: 'atm.nextStructuredOutputHint.v1' as const,
      hasPlaybook: false,
      treatCliJsonAs: 'structured-tool-guidance' as const,
      followNextActionField: 'evidence.nextAction.command' as const
    },
    ignoredArtifactForceAddHints: buildIgnoredArtifactForceAddHints(cwd),
    promptWorktreeHint: buildPromptWorktreeHint(cwd, prompt)
  };
}



function listTaskCardFiles(cwd: string): readonly string[] {
  const output = new Set<string>();
  for (const filePath of listRootLevelTaskCardFiles(cwd)) {
    output.add(filePath);
  }
  for (const root of listTaskCardDiscoveryRoots(cwd)) {
    for (const filePath of listFilesRecursive(root, (candidate) => candidate.endsWith('.task.md'))) {
      output.add(filePath);
    }
  }
  return uniqueSorted(Array.from(output));
}

function listRootLevelTaskCardFiles(cwd: string): readonly string[] {
  return safeReadDir(cwd)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.task.md'))
    .map((entry) => path.join(cwd, entry.name));
}

function listTaskCardDiscoveryRoots(cwd: string): readonly string[] {
  const relativeRoots = [
    'docs',
    'atomic_workbench',
    'specs',
    'schemas',
    'templates',
    'integrations',
    'examples',
    'tests',
    'packages',
    'scripts',
    '.agents',
    '.github',
    '.claude',
    '.cursor',
    '.gemini'
  ];
  return uniqueSorted(relativeRoots
    .map((entry) => path.join(cwd, entry))
    .filter((entry) => existsSync(entry)));
}

function listPromptScopedExternalTaskCardFiles(
  cwd: string,
  intent: TaskIntent | null,
  planningRoots: readonly string[] = resolveCandidatePlanningRoots(cwd, {
    configuredRoots: readConfiguredPlanningRoots(cwd)
  }).roots
): readonly string[] {
  if (!intent?.userPrompt || !intent.taskScopeMentioned) return [];
  const output = new Set<string>();
  for (const root of planningRoots) {
    const markdownFiles = listFilesRecursive(root, (filePath) => filePath.endsWith('.md') && !filePath.endsWith('.task.md'));
    for (const planPath of markdownFiles) {
      if (!planFileMatchesPrompt(cwd, planPath, intent)) continue;
      const taskDir = path.join(path.dirname(planPath), 'tasks');
      for (const taskPath of listFilesRecursive(taskDir, (filePath) => filePath.endsWith('.task.md'))) {
        output.add(taskPath);
      }
    }
    if (intent.mentionedTaskIds.length > 0 || intent.taskRootHints.length > 0) {
      for (const taskPath of listFilesRecursive(root, (filePath) => filePath.endsWith('.task.md'))) {
        if (taskCardPathMatchesIntent(taskPath, intent)) {
          output.add(taskPath);
        }
      }
    }
  }
  return uniqueSorted(Array.from(output));
}

function isTaskPathUnderPreferredPlanningRoots(cwd: string, taskPath: string): boolean {
  const absoluteTaskPath = path.resolve(cwd, taskPath);
  const resolution = resolveCandidatePlanningRoots(cwd, {
    configuredRoots: readConfiguredPlanningRoots(cwd)
  });
  return resolution.roots.some((root) => absoluteTaskPath.startsWith(`${root}${path.sep}`));
}

function planFileMatchesPrompt(cwd: string, planPath: string, intent: TaskIntent): boolean {
  const prompt = normalizeSearchText(intent.userPrompt ?? '');
  const relativePlanPath = path.relative(cwd, planPath).replace(/\\/g, '/');
  if (intent.mentionedPlanPaths.some((hint) => pathFieldMatches(relativePlanPath, hint) || pathFieldMatches(planPath, hint))) {
    return true;
  }

  const stem = normalizeSearchText(path.basename(planPath).replace(/\.[^.]+$/, ''));
  if (stem.length >= 8 && prompt.includes(stem)) return true;

  const title = readMarkdownTitle(planPath);
  const normalizedTitle = title ? normalizeSearchText(title) : '';
  if (normalizedTitle.length >= 8 && prompt.includes(normalizedTitle)) return true;

  return false;
}

function readMarkdownTitle(filePath: string): string | null {
  try {
    const head = readFileSync(filePath, 'utf8').split(/\r?\n/, 40);
    for (const line of head) {
      const match = /^#{1,6}\s+(.+?)\s*$/.exec(line);
      if (match?.[1]?.trim()) return match[1].trim();
    }
  } catch {
    return null;
  }
  return null;
}

function taskCardPathMatchesIntent(taskPath: string, intent: TaskIntent): boolean {
  const normalizedTaskPath = normalizeSearchText(taskPath);
  const basename = path.basename(taskPath).replace(/\.task\.md$/i, '').toUpperCase();
  if (intent.mentionedTaskIds.some((taskId) => basename === taskId || normalizedTaskPath.includes(normalizeSearchText(taskId)))) {
    return true;
  }
  return intent.taskRootHints.some((hint) => {
    const normalizedHint = normalizeSearchText(hint);
    return normalizedHint.length > 0 && normalizedTaskPath.includes(normalizedHint);
  });
}

function listFilesRecursive(directoryPath: string, predicate: (filePath: string) => boolean): readonly string[] {
  if (!existsSync(directoryPath)) return [];
  const stats = safeStat(directoryPath);
  if (!stats) return [];
  if (stats.isFile()) return predicate(directoryPath) ? [directoryPath] : [];
  const output: string[] = [];
  for (const entry of safeReadDir(directoryPath)) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory() && shouldSkipRecursiveDiscoveryDirectory(absolutePath)) continue;
    if (entry.isDirectory()) {
      output.push(...listFilesRecursive(absolutePath, predicate));
    } else if (entry.isFile() && predicate(absolutePath)) {
      output.push(absolutePath);
    }
  }
  return output;
}

function findNearbyPlanPaths(cwd: string, taskPath: string): readonly string[] {
  const taskDir = path.dirname(taskPath);
  const parent = path.basename(taskDir).toLowerCase() === 'tasks' ? path.dirname(taskDir) : taskDir;
  if (!existsSync(parent)) return [];
  return safeReadDir(parent)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.task.md'))
    .map((entry) => path.relative(cwd, path.join(parent, entry.name)).replace(/\\/g, '/'));
}

function safeReadDir(directoryPath: string): readonly Dirent[] {
  try {
    return readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

function safeStat(filePath: string) {
  try {
    return statSync(filePath);
  } catch {
    return null;
  }
}

function shouldSkipRecursiveDiscoveryDirectory(directoryPath: string) {
  const normalized = directoryPath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  const ignoredSegmentNames = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'release',
    '.atm-temp',
    'scratch',
    'tmp',
    'temp',
    'library',
    'coverage',
    '.next',
    '.turbo'
  ]);
  const basename = segments[segments.length - 1] ?? '';
  if (ignoredSegmentNames.has(basename)) return true;
  return segments.some((segment, index) => segment === 'local' && (segments[index + 1] === 'tmp' || segments[index + 1] === 'temp'));
}



function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}







function detectRequestedTaskAction(prompt: string): RequestedTaskAction | null {
  if (/\u91cd\u505a|redo/i.test(prompt)) return 'redo';
  if (/\u91cd\u65b0\u6253\u958b|reopen/i.test(prompt)) return 'reopen';
  if (/\u95dc\u9589|\u5b8c\u6210|close|done/i.test(prompt)) return 'close';
  if (/audit|\u7a3d\u6838|\u6aa2\u8a0e/i.test(prompt)) return 'audit';
  if (/cleanup|\u6e05\u7406/i.test(prompt)) return 'cleanup';
  if (/\u5206\u6790|analy[sz]e/i.test(prompt)) return 'analyze';
  if (/implement|\u5be6\u4f5c|\u958b\u767c/i.test(prompt)) return 'implement';
  return null;
}



function extractPromptPathHints(prompt: string): readonly string[] {
  const matches = prompt.match(/(?:[A-Za-z]:)?(?:[A-Za-z0-9_%\u4e00-\u9fff() -]+[\\/])+[A-Za-z0-9_%\u4e00-\u9fff(). -]+(?:\.md)?|[A-Za-z0-9_%\u4e00-\u9fff() -]+\.md/gi) ?? [];
  return uniqueSorted(matches
    .map((entry) => entry.trim().replace(/^["'`]+|["'`]+$/g, ''))
    .filter((entry) => entry.length > 2)
    .filter((entry) => /[./\\]|\.md$/i.test(entry))
    .filter(isLikelyPromptPathHint));
}


function enrichWithLegacyPlan(cwd: string, base: GuidanceNextAction, plan: LegacyRoutePlan, sessionId: string): GuidanceNextAction {
  const safeSegments = plan.segments.filter((s: LegacyRoutePlanSegment) => plan.safeFirstAtoms.includes(s.symbolName));
  const preferredSegment: LegacyRoutePlanSegment | null =
    safeSegments.find((s: LegacyRoutePlanSegment) => s.recommendedBehavior === 'split')
    ?? safeSegments.find((s: LegacyRoutePlanSegment) => s.recommendedBehavior === 'infect')
    ?? safeSegments.find((s: LegacyRoutePlanSegment) => s.recommendedBehavior === 'atomize')
    ?? null;
  const blockedSegments: readonly string[] = plan.trunkFunctions;

  if (!preferredSegment) {
    return {
      ...base,
      status: 'blocked',
      reason: 'No safe leaf segment is available in the LegacyRoutePlan. Submit a split proposal before proceeding.',
      blockedSegments
    };
  }

  const legacyTarget = `${plan.targetFile}#${preferredSegment.symbolName}`;
  const queueMatch = findMatchingGuidedLegacyProposal(cwd, {
    guidanceSession: sessionId,
    legacyTarget,
    behaviorId: `behavior.${preferredSegment.recommendedBehavior}`
  });
  if (queueMatch) {
    const actualPatchEvidence = queueMatch.status === 'approved'
      ? findGuidedLegacyActualPatchEvidence(cwd, queueMatch.proposalId)
      : null;
    const command = actualPatchEvidence
      ? `node atm.mjs review rollout-ready ${quoteCliValue(queueMatch.proposalId)} --json`
      : queueMatch.status === 'approved'
        ? `node atm.mjs review apply-ready ${quoteCliValue(queueMatch.proposalId)} --json`
      : `node atm.mjs review show ${quoteCliValue(queueMatch.proposalId)} --json`;
    const waitingForReview = queueMatch.status === 'pending' || queueMatch.status === 'blocked';
    const missingEvidence = reconcileProposalMissingEvidence(base.missingEvidence, preferredSegment.recommendedBehavior, queueMatch.status);
    return {
      ...base,
      status: 'action',
      command,
      reason: actualPatchEvidence
        ? `Approved guided legacy proposal ${queueMatch.proposalId} already has actual patch, smoke evidence, and rollback-ready proof; inspect the rollout-ready packet before closing the governed rollout.`
        : queueMatch.status === 'approved'
        ? `Approved guided legacy dry-run proposal ${queueMatch.proposalId} already covers ${legacyTarget}; inspect the approved boundary and proceed with actual patch planning inside that safe leaf.`
        : `Matching guided legacy dry-run proposal ${queueMatch.proposalId} already exists for ${legacyTarget}; inspect that proposal instead of generating a duplicate.`,
      allowedCommands: Array.from(new Set([...base.allowedCommands, command])),
      selectedSegment: preferredSegment.symbolName,
      legacyTarget,
      targetFile: plan.targetFile,
      selectedBehavior: preferredSegment.recommendedBehavior,
      blockedSegments,
      proposalId: queueMatch.proposalId,
      proposalStatus: queueMatch.status,
      nextRouteState: actualPatchEvidence
        ? 'proposal-rollout-ready'
        : queueMatch.status === 'approved'
        ? 'proposal-approved'
        : queueMatch.status === 'rejected'
          ? 'proposal-rejected'
          : 'proposal-pending-review',
      missingEvidence: actualPatchEvidence
        ? []
        : waitingForReview
        ? dedupeStrings([...missingEvidence, 'human review before apply'])
        : missingEvidence
    };
  }

  const command = `node atm.mjs upgrade --propose --behavior behavior.${preferredSegment.recommendedBehavior} --legacy-target ${quoteCliValue(legacyTarget)} --guidance-session ${quoteCliValue(sessionId)} --dry-run --json`;

  return {
    ...base,
    status: 'action',
    command,
    allowedCommands: Array.from(new Set([...base.allowedCommands, command])),
    selectedSegment: preferredSegment.symbolName,
    legacyTarget,
    targetFile: plan.targetFile,
    selectedBehavior: preferredSegment.recommendedBehavior,
    blockedSegments,
    nextRouteState: 'proposal-required'
  };
}

interface MatchingGuidedLegacyProposal {
  readonly proposalId: string;
  readonly status: HumanReviewQueueStatus;
}

interface GuidedLegacyActualPatchEvidence {
  readonly reportPath: string;
  readonly proposalId: string;
  readonly generatedAt?: string;
  readonly smokeEvidence?: readonly unknown[];
  readonly rollbackReadyProof?: {
    readonly proofPath?: string;
    readonly patchPath?: string;
  } | null;
}

function findMatchingGuidedLegacyProposal(
  cwd: string,
  criteria: {
    readonly guidanceSession: string;
    readonly legacyTarget: string;
    readonly behaviorId: string;
  }
): MatchingGuidedLegacyProposal | null {
  const queuePath = path.join(cwd, '.atm', 'history', 'reports', 'upgrade-proposals.json');
  const queue = loadHumanReviewQueueDocument(queuePath);
  if (!queue) {
    return null;
  }

  const matches = queue.entries
    .filter((entry) => isMatchingGuidedLegacyProposal(entry, criteria))
    .sort(compareGuidedLegacyQueuePriority);

  const selected = matches[0];
  if (!selected) {
    return null;
  }

  return {
    proposalId: selected.proposalId,
    status: selected.status
  };
}

function isMatchingGuidedLegacyProposal(
  entry: HumanReviewQueueRecord,
  criteria: {
    readonly guidanceSession: string;
    readonly legacyTarget: string;
    readonly behaviorId: string;
  }
) {
  return entry.proposal.guidanceSession === criteria.guidanceSession
    && entry.proposal.legacyTarget === criteria.legacyTarget
    && entry.proposal.behaviorId === criteria.behaviorId;
}



function findGuidedLegacyActualPatchEvidence(cwd: string, proposalId: string): GuidedLegacyActualPatchEvidence | null {
  const reportsRoot = path.join(cwd, '.atm', 'history', 'reports');
  if (!existsSync(reportsRoot)) {
    return null;
  }

  const matches = readdirSync(reportsRoot)
    .filter((entry) => entry.startsWith('actual-patch-evidence.') && entry.endsWith('.json'))
    .flatMap((entry): GuidedLegacyActualPatchEvidence[] => {
      const reportPath = path.join(reportsRoot, entry);
      try {
        const parsed = parseJsonText(readFileSync(reportPath, 'utf8')) as Record<string, unknown>;
        if (parsed['proposalId'] !== proposalId) {
          return [];
        }
        const smokeEvidence = Array.isArray(parsed['smokeEvidence']) ? parsed['smokeEvidence'] : [];
        const rollbackReadyProof = parsed['rollbackReadyProof'] && typeof parsed['rollbackReadyProof'] === 'object'
          ? parsed['rollbackReadyProof'] as { readonly proofPath?: string; readonly patchPath?: string; }
          : null;
        if (smokeEvidence.length === 0 || !rollbackReadyProof?.proofPath) {
          return [];
        }
        return [{
          reportPath: path.relative(cwd, reportPath).replace(/\\/g, '/'),
          proposalId,
          generatedAt: typeof parsed['generatedAt'] === 'string' ? parsed['generatedAt'] : undefined,
          smokeEvidence,
          rollbackReadyProof
        }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => compareIsoDesc(left.generatedAt, right.generatedAt));

  return matches[0] ?? null;
}


function reconcileProposalMissingEvidence(
  missingEvidence: readonly string[],
  behavior: string,
  proposalStatus: HumanReviewQueueStatus
) {
  const filtered = missingEvidence.filter((entry) => entry !== `${behavior} dry-run proposal`);
  if (proposalStatus === 'approved' || proposalStatus === 'rejected') {
    return filtered.filter((entry) => entry !== 'human review before apply');
  }
  return filtered;
}

function mapStatusToSlashCommandId(status: string): string {
  if (status === 'needs-bootstrap' || status === 'needs-onboarding-refresh') {
    return 'atm-next';
  }
  if (status === 'needs-guidance-start') {
    return 'atm-orient';
  }
  if (status === 'needs-evidence' || status === 'needs-validation' || status === 'blocked') {
    return 'atm-evidence';
  }
  if (status === 'needs-handoff') {
    return 'atm-handoff';
  }
  return 'atm-next';
}

function buildAgentPackHint(status: string, command: string, reason: string) {
  return {
    slashCommandId: mapStatusToSlashCommandId(status),
    route: status,
    command,
    reason
  };
}

function buildTaskflowCloseOperatorCommands(taskId: string, actor: string) {
  const id = taskId || '<task-id>';
  return {
    preClose: `node atm.mjs taskflow pre-close --task ${id} --actor ${actor} --json`,
    dryRun: `node atm.mjs taskflow close --task ${id} --actor ${actor} --json`,
    write: `node atm.mjs taskflow close --task ${id} --actor ${actor} --write --json`
  };
}

function buildTaskDeliveryPrinciple(input: { readonly channel: 'normal' | 'batch'; readonly taskId?: string }) {
  return {
    schemaId: 'atm.taskDeliveryPrinciple.v1',
    taskId: input.taskId ?? null,
    channel: input.channel,
    principle: 'The goal is to deliver the requested task content, not to close task cards.',
    instruction: 'Implement or update the real non-.atm deliverables first; only close the task after those deliverables exist and validators/evidence pass.',
    doneMeans: 'done records completed delivery; it is not the objective itself.',
    notAllowedAsCompletion: [
      'changing only .atm/history task status or task events',
      'adding text-only evidence without real deliverable files',
      'replaying or cherry-picking old close commits',
      'batch-closing later tasks before the current queue head is delivered'
    ],
    nextStep: input.channel === 'batch'
      ? 'Work only on the current queue head, produce its real deliverables, then run node atm.mjs batch checkpoint --actor <id> --json.'
      : 'Run taskflow pre-close, then taskflow close dry-run (no --write), read evidence.writeReadinessHint.blockers[].requiredCommand, then taskflow close --write.'
  };
}

function buildMirrorSyncNextAction(input: {
  readonly task: ImportedTaskSummary;
  readonly classification: TaskDeliveryClassification;
}) {
  const sourcePath = input.task.sourcePlanPath ?? '<source-task-card-path>';
  const hasActiveClaim = typeof input.task.activeClaimActorId === 'string' && input.task.activeClaimActorId.length > 0;
  const importCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --write --force --json`;
  const dryRunCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --dry-run --json`;

  if (hasActiveClaim) {
    return {
      status: 'task-mirror-sync-blocked',
      command: dryRunCommand,
      reason: `Task ${input.task.workItemId} has an active claim by actor ${input.task.activeClaimActorId}. Mirror-sync write is blocked to prevent claim/lock overwrite.`,
      recommendedChannel: 'mirror-sync' as const,
      riskLevel: 'high' as const,
      requiredCommand: null,
      deliveryClassification: input.classification,
      mirrorSync: {
        schemaId: 'atm.taskMirrorSync.v1',
        taskId: input.task.workItemId,
        targetRepo: input.classification.targetRepo,
        closureAuthority: input.classification.closureAuthority,
        planningRepo: input.classification.planningRepo,
        ledgerStatus: input.classification.ledgerStatus,
        sourceStatus: input.classification.sourceStatus,
        statusDivergence: input.classification.statusDivergence,
        sourcePlanPath: input.task.sourcePlanPath,
        ledgerMirrorPath: input.task.taskPath,
        recommendedCommandSequence: [
          `# WARNING: Active claim exists for ${input.task.activeClaimActorId}`,
          `# Release or handoff the task before performing a forced mirror write.`,
          dryRunCommand
        ],
        doNotDeliverHere: true
      },
      allowedCommands: [
        dryRunCommand,
        'node atm.mjs tasks audit --task <task-id> --json',
        'node atm.mjs framework-mode status --json'
      ],
      blockedCommands: [
        importCommand,
        'editing or staging this task\'s deliverables in the current repo',
        'node atm.mjs next --claim for this task in the current repo',
        'node atm.mjs tasks close for this task in the current repo'
      ]
    };
  }

  return {
    status: 'task-mirror-sync-required',
    command: input.classification.statusDivergence ? importCommand : dryRunCommand,
    reason: input.classification.reason,
    recommendedChannel: 'mirror-sync' as const,
    riskLevel: 'low' as const,
    requiredCommand: input.classification.statusDivergence ? importCommand : dryRunCommand,
    deliveryClassification: input.classification,
    mirrorSync: {
      schemaId: 'atm.taskMirrorSync.v1',
      taskId: input.task.workItemId,
      targetRepo: input.classification.targetRepo,
      closureAuthority: input.classification.closureAuthority,
      planningRepo: input.classification.planningRepo,
      ledgerStatus: input.classification.ledgerStatus,
      sourceStatus: input.classification.sourceStatus,
      statusDivergence: input.classification.statusDivergence,
      sourcePlanPath: input.task.sourcePlanPath,
      ledgerMirrorPath: input.task.taskPath,
      recommendedCommandSequence: input.classification.statusDivergence
        ? [
          importCommand,
          `git add ${quoteCliValue(input.task.taskPath)}`,
          `git commit -m "atm: sync ${input.task.workItemId} ledger mirror from planning source"`
        ]
        : [dryRunCommand],
      doNotDeliverHere: true
    },
    allowedCommands: [
      importCommand,
      dryRunCommand,
      'node atm.mjs tasks audit --task <task-id> --json',
      'node atm.mjs framework-mode status --json'
    ],
    blockedCommands: [
      'editing or staging this task\'s deliverables in the current repo',
      'node atm.mjs next --claim for this task in the current repo',
      'node atm.mjs tasks close for this task in the current repo',
      'creating evidence for non-existent deliverable files'
    ]
  };
}

type GovernanceChannel = 'fast' | 'normal' | 'batch';
type BatchPlaybookState = 'queue-preview' | 'queue-head-active' | 'repair-required';

function buildChannelPlaybook(input: {
  readonly channel: GovernanceChannel;
  readonly taskId?: string | null;
  readonly originalPrompt?: string | null;
  readonly queueHeadTaskId?: string | null;
  readonly actorPlaceholder?: string;
  readonly batchId?: string | null;
  readonly batchState?: BatchPlaybookState;
}) {
  const actor = input.actorPlaceholder ?? '<id>';
  const prompt = input.originalPrompt?.trim() || '<current user prompt>';
  const taskId = input.taskId ?? '<task-id>';
  const defaultClaimCommand = `node atm.mjs next --claim --actor ${actor} --prompt ${quoteCliValue(prompt)} --auto-intent --json`;
  const closeOps = buildTaskflowCloseOperatorCommands(taskId, actor);
  if (input.channel === 'fast') {
    return {
      schemaId: 'atm.channelPlaybook.v1',
      channel: 'fast',
      title: 'Fast quickfix playbook',
      mustFollow: true,
      summary: 'Use this only for small, low-risk edits. It is not a task-card closure path.',
      steps: [
        `Run: ${defaultClaimCommand}`,
        'Edit only the allowed files returned by ATM.',
        'Run the smallest relevant validator for the touched file.',
        'Commit only the real non-.atm diff and any required git-head evidence.'
      ],
      doNot: [
        'Do not edit .atm/history/**.',
        'Do not close task cards.',
        'Do not expand the scope after the quickfix lock is created.'
      ],
      commandSequence: [
        defaultClaimCommand,
        '<edit allowed files>',
        '<run focused validator>',
        'git add <changed files>',
        `node atm.mjs git commit --actor ${actor} --message "<message>" --json`
      ],
      commitTiming: 'Commit after the focused validator passes. Prefer `node atm.mjs git commit` for governed framework work; bare `git commit` is for read-only inspection or non-governed maintenance only.',
      governedGitEntrypoint: {
        preferredCommand: `node atm.mjs git commit --actor ${actor} --message "<message>" --json`,
        directGitPolicy: 'Direct git remains available for read-only commands and non-governed maintenance. When staging .atm/history/** task or evidence files, use the ATM wrapper so trailers and claim binding stay consistent.'
      }
    };
  }
  if (input.channel === 'batch') {
    const head = input.queueHeadTaskId ?? input.taskId ?? '<queue-head-task-id>';
    const batchState = input.batchState ?? 'queue-head-active';
    const batchLabel = input.batchId ? `batch ${input.batchId}` : 'this batch';
    const isRepairState = batchState === 'repair-required';
    const batchClaimCommand = defaultClaimCommand;
    const batchRepairCommand = `node atm.mjs batch repair --actor ${actor}${input.batchId ? ` --batch ${input.batchId}` : ''} --json`;
    const stateSummary = batchState === 'queue-preview'
      ? 'This is a batch preview. Claim the queue head, then work one task at a time.'
      : isRepairState
        ? `${batchLabel} is out of sync and needs repair before any task work continues.`
        : 'This is an active batch. Keep work on the current queue head and checkpoint before commit.';
    const commandSequence = isRepairState
      ? [
        batchRepairCommand,
        batchClaimCommand,
        '<implement queue-head deliverables>',
        'node atm.mjs evidence add --task <queue-head-task-id> --actor <id> --kind test --freshness fresh --summary "<what passed>" --artifacts <real-files> --validators <validator-name> --command "<command>" --exit-code 0 --stdout-sha256 sha256:<hash> --stderr-sha256 sha256:<hash> --json',
        'git add <deliverables> .atm/history/evidence/<queue-head-task-id>.json',
        `node atm.mjs batch checkpoint --actor ${actor} --json`,
        'git add .atm/history/tasks/<queue-head-task-id>.json .atm/history/task-events/<queue-head-task-id>/',
        `node atm.mjs git commit --actor ${actor} --task <queue-head-task-id> --message "<scope>: complete <queue-head-task-id>" --json`
      ]
      : [
        batchClaimCommand,
        '<implement queue-head deliverables>',
        'node atm.mjs evidence add --task <queue-head-task-id> --actor <id> --kind test --freshness fresh --summary "<what passed>" --artifacts <real-files> --validators <validator-name> --command "<command>" --exit-code 0 --stdout-sha256 sha256:<hash> --stderr-sha256 sha256:<hash> --json',
        'git add <deliverables> .atm/history/evidence/<queue-head-task-id>.json',
        `node atm.mjs batch checkpoint --actor ${actor} --json`,
        'git add .atm/history/tasks/<queue-head-task-id>.json .atm/history/task-events/<queue-head-task-id>/',
        `node atm.mjs git commit --actor ${actor} --task <queue-head-task-id> --message "<scope>: complete <queue-head-task-id>" --json`
      ];
    return {
      schemaId: 'atm.channelPlaybook.v1',
      channel: 'batch',
      title: 'Batch queue-head playbook',
      mustFollow: true,
      summary: stateSummary,
      state: batchState,
      steps: isRepairState
        ? [
          `Run: ${batchRepairCommand}`,
          `Then rerun: ${batchClaimCommand}`,
          `Work only on the current queue head: ${head}.`,
          'Read that task contract and implement the real non-.atm deliverables.',
          'Run the required validator or a focused reproducible verification command.',
          'Add command-backed evidence for the current queue head.',
          'Stage the deliverables and evidence before checkpoint, but do not commit yet.',
          `Run: node atm.mjs batch checkpoint --actor ${actor} --json`,
          'After checkpoint succeeds, stage the updated .atm/history task/event files and create one commit that contains both deliverables and checkpoint state.',
          'Continue with the next queue head returned by batch checkpoint.'
        ]
        : [
          `Run: ${batchClaimCommand}`,
          `Work only on the current queue head: ${head}.`,
          'Read that task contract and implement the real non-.atm deliverables.',
          'Run the required validator or a focused reproducible verification command.',
          'Add command-backed evidence for the current queue head.',
          'Stage the deliverables and evidence before checkpoint, but do not commit yet.',
          `Run: node atm.mjs batch checkpoint --actor ${actor} --json`,
          'After checkpoint succeeds, stage the updated .atm/history task/event files and create one commit that contains both deliverables and checkpoint state.',
          'Continue with the next queue head returned by batch checkpoint.'
        ],
      doNot: [
        'Do not run tasks reserve/promote/claim/close manually.',
        'Do not run next --prompt with a later single task id to leave batch.',
        'Do not commit before batch checkpoint succeeds.',
        'Do not close later tasks before the queue head is delivered.',
        'Do not use .atm/history/** changes as the deliverable.'
      ],
      commandSequence,
      commitTiming: isRepairState
        ? 'Repair the batch runtime first, then stage deliverables before checkpoint; commit once after batch checkpoint succeeds.'
        : 'Stage deliverables before checkpoint; commit once after batch checkpoint succeeds.',
      checkpointCommand: `node atm.mjs batch checkpoint --actor ${actor} --json`,
      repairCommand: batchRepairCommand,
      governedGitEntrypoint: {
        preferredCommand: `node atm.mjs git commit --actor ${actor} --task <queue-head-task-id> --message "<scope>: complete <queue-head-task-id>" --json`,
        directGitPolicy: 'Batch delivery commits must use the ATM wrapper after checkpoint; bare git commit is not banned for read-only inspection.'
      }
    };
  }
  return {
    schemaId: 'atm.channelPlaybook.v1',
    channel: 'normal',
    title: 'Single-task playbook',
    mustFollow: true,
    summary: 'Use this for one explicit task card. Preview close with taskflow pre-close and taskflow close dry-run before --write.',
    steps: [
      `Run: ${defaultClaimCommand}`,
      'Work only on the claimed task and its allowed files.',
      'Implement the real non-.atm deliverables.',
      'Run required validators or a focused reproducible verification command.',
      'Add command-backed evidence.',
      `Run: ${closeOps.preClose}`,
      `Run: ${closeOps.dryRun} and read evidence.writeReadinessHint.blockers[].requiredCommand`,
      `When ready: ${closeOps.write}`
    ],
    doNot: [
      'Do not manually reserve/promote/claim before next --claim.',
      'Do not call tasks close directly for normal closeback; taskflow close owns the operator lane.',
      'Do not run taskflow close --write before dry-run/pre-close when blockers are unknown.',
      'Do not commit task closure separately from the deliverable it proves.'
    ],
    commandSequence: [
      defaultClaimCommand,
      '<implement task deliverables>',
      'node atm.mjs evidence run --task <task-id> --actor <id> --command "<validator>" --json',
      closeOps.preClose,
      closeOps.dryRun,
      closeOps.write,
      'git add <deliverables> .atm/history/tasks/<task-id>.json .atm/history/evidence/<task-id>.json .atm/history/task-events/<task-id>/',
      `node atm.mjs git commit --actor ${actor} --task <task-id> --message "<scope>: complete <task-id>" --json`
    ],
    closePreview: {
      schemaId: 'atm.taskflowClosePreviewPlaybook.v1',
      preCloseCommand: closeOps.preClose,
      dryRunCommand: closeOps.dryRun,
      writeCommand: closeOps.write,
      hintField: 'evidence.writeReadinessHint.blockers[].requiredCommand'
    },
    commitTiming: 'Commit only after taskflow close --write succeeds and the governed bundle is committed.',
    governedGitEntrypoint: {
      preferredCommand: `node atm.mjs git commit --actor ${actor} --task <task-id> --message "<scope>: complete <task-id>" --json`,
      directGitPolicy: 'Use taskflow close --write for normal closure. Bare git commit is not banned globally, but governed task/evidence bundles must use the ATM wrapper.',
      fallbackFields: ['copyableCommitCommand', 'hostGitCompatibilityGuidance']
    }
  };
}

function embedTeamRecommendation<T extends { readonly playbook?: unknown }>(
  nextAction: T,
  input: Parameters<typeof buildTeamRecommendation>[0]
): T & { teamRecommendation?: TeamRecommendation | null } {
  const teamRecommendation = buildTeamRecommendation(input);
  if (!teamRecommendation) {
    return nextAction;
  }
  const playbook = nextAction.playbook && typeof nextAction.playbook === 'object' && !Array.isArray(nextAction.playbook)
    ? { ...(nextAction.playbook as Record<string, unknown>), teamRecommendation }
    : nextAction.playbook;
  return {
    ...nextAction,
    teamRecommendation,
    playbook
  };
}

type NextActionLike = {
  status: string;
  command?: string;
  reason?: string;
  recommendedChannel?: string | null;
  riskLevel?: string;
  selectedTask?: unknown;
  selectedTasks?: unknown;
  taskQueue?: unknown;
  queueHeadTaskId?: string | null;
  batchId?: string | null;
  taskDirectionLock?: { readonly taskId?: string; readonly schemaId?: string };
  deliveryPrinciple?: ReturnType<typeof buildTaskDeliveryPrinciple>;
  playbook?: ReturnType<typeof buildChannelPlaybook>;
  teamRecommendation?: TeamRecommendation | null;
  allowedCommands?: readonly string[];
  blockedCommands?: readonly string[];
  missingEvidence?: readonly string[];
  closure?: { readonly closurePacketPath?: string | null };
  decisionTrail?: NextDecisionTrailEntry[];
  playbookState?: 'present' | 'absent';
  structuredOutputHint?: {
    readonly schemaId: 'atm.nextStructuredOutputHint.v1';
    readonly hasPlaybook: boolean;
    readonly treatCliJsonAs: 'structured-tool-guidance';
    readonly followNextActionField: 'evidence.nextAction.command';
  };
  ignoredArtifactForceAddHints?: readonly {
    readonly path: string;
    readonly requiredCommand: string;
    readonly reason: string;
  }[];
  promptWorktreeHint?: {
    readonly schemaId: 'atm.promptWorktreeHint.v1';
    readonly promptPathHints: readonly string[];
    readonly promptMatchedFiles: readonly string[];
    readonly atmManagedFiles: readonly string[];
    readonly generatedArtifactFiles: readonly string[];
    readonly releaseMirrorFiles: readonly string[];
    readonly unrelatedTrackedFiles: readonly string[];
    readonly unrelatedUntrackedFiles: readonly string[];
    readonly ignoredArtifactCount: number;
    readonly note: string;
  };
  governanceReadiness?: {
    readonly schemaId: 'atm.nextGovernanceReadinessHint.v1';
    readonly channel: GovernanceChannel | null;
    readonly currentBranch: string | null;
    readonly upstreamRef: string | null;
    readonly protectedBranchTarget: boolean;
    readonly aheadCount: number;
    readonly frameworkClaimRequired: boolean;
    readonly earlyPreparation: readonly string[];
    readonly queueRetryCodes: readonly string[];
    readonly protectedPushHint: string | null;
  };
};

function ensureDecisionTrail(nextAction: NextActionLike) {
  if (Array.isArray(nextAction.decisionTrail) && nextAction.decisionTrail.length > 0) {
    return nextAction;
  }
  nextAction.decisionTrail = buildDecisionTrail(nextAction);
  return nextAction;
}

function buildDecisionTrail(nextAction: NextActionLike): NextDecisionTrailEntry[] {
  const entries: NextDecisionTrailEntry[] = [{
    check: 'route-status',
    result: decisionResultForStatus(nextAction.status),
    reason: nextAction.reason ?? `ATM selected route status ${nextAction.status}.`,
    ...(nextAction.command ? { nextCommand: nextAction.command } : {})
  }];

  const selectedTaskId = readTaskId(nextAction.selectedTask);
  if (selectedTaskId) {
    entries.push({
      check: 'task-selection',
      result: 'pass',
      reason: `Selected task ${selectedTaskId}.`
    });
  } else if (Array.isArray(nextAction.selectedTasks)) {
    entries.push({
      check: 'task-selection',
      result: nextAction.selectedTasks.length > 0 ? 'pass' : 'blocked',
      reason: `Selected ${nextAction.selectedTasks.length} task candidate(s).`
    });
  }

  if (nextAction.status === 'task-scope-not-found') {
    entries.push({
      check: 'prompt-scope-resolution',
      result: 'blocked',
      reason: 'No matching task scope was found; ATM did not fall back to unrelated task cards.'
    });
  }

  if (nextAction.status === 'task-no-work') {
    entries.push({
      check: 'prompt-scope-resolution',
      result: 'pass',
      reason: 'The scoped prompt resolved cleanly, but no open imported work remains for that scope.'
    });
  }

  if (nextAction.status === 'task-selection-required') {
    entries.push({
      check: 'prompt-scope-resolution',
      result: 'blocked',
      reason: 'Multiple task scopes matched; ATM requires a more specific prompt before routing.'
    });
  }

  if (nextAction.recommendedChannel) {
    entries.push({
      check: 'work-channel',
      result: 'info',
      reason: `Recommended ${nextAction.recommendedChannel} channel with ${nextAction.riskLevel ?? 'unknown'} risk.`
    });
  }

  const queueHeadTaskId = nextAction.queueHeadTaskId ?? readQueueHeadTaskId(nextAction.taskQueue);
  if (queueHeadTaskId) {
    entries.push({
      check: 'queue-head',
      result: 'pass',
      reason: `Current queue head is ${queueHeadTaskId}.`
    });
  }

  if (nextAction.taskDirectionLock?.schemaId === 'atm.taskDirectionLock.v1') {
    const taskId = nextAction.taskDirectionLock.taskId ?? selectedTaskId ?? queueHeadTaskId ?? '<task>';
    entries.push({
      check: 'task-direction-lock',
      result: 'pass',
      reason: `Task direction lock is active for ${taskId}.`,
      evidencePath: `.atm/runtime/locks/${taskId}.lock.json`
    });
  }

  if (Array.isArray(nextAction.missingEvidence) && nextAction.missingEvidence.length > 0) {
    entries.push({
      check: 'missing-evidence',
      result: 'blocked',
      reason: `Missing evidence: ${nextAction.missingEvidence.join(', ')}.`
    });
  }

  if (nextAction.closure?.closurePacketPath) {
    entries.push({
      check: 'closure-state',
      result: 'pass',
      reason: 'Task closure packet is available.',
      evidencePath: nextAction.closure.closurePacketPath
    });
  }

  if (Array.isArray(nextAction.allowedCommands) && nextAction.allowedCommands.length > 0) {
    entries.push({
      check: 'allowed-commands',
      result: 'info',
      reason: `${nextAction.allowedCommands.length} allowed command(s) are exposed for the route.`
    });
  }

  if (Array.isArray(nextAction.blockedCommands) && nextAction.blockedCommands.length > 0) {
    entries.push({
      check: 'blocked-commands',
      result: 'info',
      reason: `${nextAction.blockedCommands.length} blocked command pattern(s) are exposed for the route.`
    });
  }

  return entries;
}



function readTaskId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as { readonly workItemId?: unknown }).workItemId;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

function readQueueHeadTaskId(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = (value as { readonly queueHeadTaskId?: unknown }).queueHeadTaskId;
  return typeof candidate === 'string' && candidate.trim().length > 0 ? candidate.trim() : null;
}

function buildNextMessages(
  nextAction: NextActionLike,
  userNotice: AtmUserNotice | null,
  integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>,
  runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>,
  routeMessage: ReturnType<typeof message>
) {
  ensureDecisionTrail(nextAction);
  const messages = [];
  if (userNotice) {
    messages.push(message('info', 'ATM_USER_NOTICE', userNotice.spokenLine, {
      displayPolicy: userNotice.displayPolicy,
      mustShowBeforeAction: userNotice.mustShowBeforeAction,
      agentInstruction: userNotice.agentInstruction,
      afterNextActionInstruction: userNotice.afterNextActionInstruction,
      route: nextAction.status
    }));
  }
  const integrationInstallHint = describeIntegrationInstallHint(integrationBootstrap);
  if (integrationInstallHint) {
    messages.push(message(
      'warning',
      'ATM_NEXT_INTEGRATION_INSTALL_RECOMMENDED',
      integrationInstallHint.text,
      integrationInstallHint.data
    ));
  }
  if (runtimeAdapterReadiness.needsRuntimeAdapterHint) {
    messages.push(message(
      'warning',
      'ATM_PYTHON_RUNTIME_ADAPTER_RECOMMENDED',
      runtimeAdapterReadiness.suggestedAction ?? 'Python entrypoints were detected. Select a Python runtime adapter/plugin before expecting ATM atom birth or apply routes to mutate Python surfaces.',
      {
        detectedLanguages: runtimeAdapterReadiness.detectedLanguages,
        bundledLanguageAdapters: runtimeAdapterReadiness.bundledLanguageAdapters,
        bundledProjectAdapters: runtimeAdapterReadiness.bundledProjectAdapters,
        pythonLanguageAdapterAvailable: runtimeAdapterReadiness.pythonLanguageAdapterAvailable,
        candidateRankingAllowed: runtimeAdapterReadiness.candidateRankingAllowed,
        atomBirthApplyDeferred: runtimeAdapterReadiness.atomBirthApplyDeferred,
        missingCapability: runtimeAdapterReadiness.missingCapability
      }
    ));
  }
  if (nextAction.playbook) {
    messages.push(message(
      'warning',
      'ATM_CHANNEL_PLAYBOOK_REQUIRED',
      `Follow the ${nextAction.playbook.channel} playbook exactly before editing, closing, or committing.`,
      nextAction.playbook
    ));
    if (nextAction.playbook.channel === 'normal') {
      messages.push(message(
        'info',
        'ATM_TASK_CLOSE_REMINDER',
        'Normal task cards are not finished at validators or evidence: after deliverables exist, always run tasks close before committing.',
        {
          schemaId: 'atm.taskCloseReminder.v1',
          taskId: readTaskId(nextAction.selectedTask) ?? nextAction.queueHeadTaskId ?? null,
          playbookChannel: 'normal'
        }
      ));
    }
  } else if (nextAction.playbookState === 'absent') {
    messages.push(message(
      'info',
      'ATM_NEXT_PLAYBOOK_ABSENT',
      'This route has no channel playbook. Treat the CLI JSON as structured ATM guidance and follow evidence.nextAction.command as the single next action before mutating files.',
      nextAction.structuredOutputHint ?? {
        schemaId: 'atm.nextStructuredOutputHint.v1',
        hasPlaybook: false,
        treatCliJsonAs: 'structured-tool-guidance',
        followNextActionField: 'evidence.nextAction.command'
      }
    ));
  }
  if ((nextAction.ignoredArtifactForceAddHints?.length ?? 0) > 0) {
    messages.push(message(
      'warning',
      'ATM_NEXT_IGNORED_ARTIFACT_FORCE_ADD_HINT',
      'ATM found ignored artifact paths in the current worktree. If one of them is the intended deliverable for the selected route, force-add it explicitly instead of assuming normal git add will see it.',
      {
        schemaId: 'atm.ignoredArtifactForceAddHints.v1',
        hints: nextAction.ignoredArtifactForceAddHints
      }
    ));
  }
  const promptWorktreeHint = nextAction.promptWorktreeHint;
  if (
    promptWorktreeHint
    && (
      promptWorktreeHint.promptMatchedFiles.length > 0
      || promptWorktreeHint.atmManagedFiles.length > 0
      || promptWorktreeHint.generatedArtifactFiles.length > 0
      || promptWorktreeHint.releaseMirrorFiles.length > 0
      || promptWorktreeHint.unrelatedTrackedFiles.length > 0
      || promptWorktreeHint.unrelatedUntrackedFiles.length > 0
      || promptWorktreeHint.ignoredArtifactCount > 0
    )
  ) {
    messages.push(message(
      'info',
      'ATM_NEXT_WORKTREE_SCOPE_HINT',
      'ATM classified current dirty files before task selection so you can distinguish prompt-matched hints from unrelated or generated residue.',
      promptWorktreeHint
    ));
  }
  const deliveryPrinciple = nextAction.deliveryPrinciple
    ?? (nextAction.selectedTask || nextAction.selectedTasks ? buildTaskDeliveryPrinciple({ channel: nextAction.selectedTasks ? 'batch' : 'normal' }) : null);
  if (deliveryPrinciple) {
    messages.push(message(
      'warning',
      'ATM_TASK_DELIVERY_PRINCIPLE',
      'Task cards are not targets to close; they are delivery contracts. Implement the requested non-.atm deliverables before closing.',
      deliveryPrinciple
    ));
  }
  if (nextAction.teamRecommendation?.enabled) {
    messages.push(message(
      'info',
      'ATM_TEAM_RECOMMENDATION',
      nextAction.teamRecommendation.reason,
      {
        schemaId: nextAction.teamRecommendation.schemaId,
        plan: nextAction.teamRecommendation.plan,
        start: nextAction.teamRecommendation.start,
        status: nextAction.teamRecommendation.status,
        recipeId: nextAction.teamRecommendation.recipeId,
        taskId: nextAction.teamRecommendation.taskId,
        ...(nextAction.teamRecommendation.knowledgeSummary ? {
          knowledgeSummary: nextAction.teamRecommendation.knowledgeSummary
        } : {})
      }
    ));
  }
  if (nextAction.governanceReadiness) {
    messages.push(message(
      'info',
      'ATM_NEXT_GOVERNANCE_READINESS_HINT',
      'ATM surfaced the governance prerequisites early so the agent can prepare claim, evidence, and protected-push checks before reaching commit or push.',
      nextAction.governanceReadiness
    ));
  }
  messages.push(routeMessage);
  return messages;
}

function buildGovernanceReadinessHint(cwd: string, input: {
  readonly channel: GovernanceChannel | null;
  readonly prompt: string;
  readonly taskId?: string | null;
  readonly frameworkClaimRequired?: boolean;
}) {
  const frameworkStatus = createFrameworkModeStatus({ cwd });
  const currentBranch = runGitScalar(cwd, ['branch', '--show-current']);
  const upstreamRef = currentBranch ? runGitScalar(cwd, ['rev-parse', '--abbrev-ref', `${currentBranch}@{upstream}`]) : null;
  const aheadCount = upstreamRef ? Number.parseInt(runGitScalar(cwd, ['rev-list', '--count', `${upstreamRef}..HEAD`]) ?? '0', 10) || 0 : 0;
  const protectedBranchTarget = Boolean(currentBranch && isProtectedFrameworkBranchTarget(currentBranch));
  const earlyPreparation = [
    'Read evidence.nextAction.playbook before editing, closing, or committing.',
    'Resolve explicit actor identity before claim, commit, or report.',
    ...(input.frameworkClaimRequired || (frameworkStatus.repoIdentity.isFrameworkRepo && isFrameworkMaintenancePrompt(input.prompt))
      ? ['Acquire framework-mode claim before editing framework-critical files.']
      : []),
    ...(input.channel === 'batch'
      ? ['Stay on the queue head and expect batch checkpoint before commit.']
      : []),
    ...(protectedBranchTarget
      ? ['Do not wait until push to discover protected-branch evidence or branch-queue blockers; rerun doctor and hook pre-push proactively.']
      : [])
  ];
  return {
    schemaId: 'atm.nextGovernanceReadinessHint.v1' as const,
    channel: input.channel,
    currentBranch,
    upstreamRef,
    protectedBranchTarget,
    aheadCount,
    frameworkClaimRequired: Boolean(input.frameworkClaimRequired),
    earlyPreparation,
    queueRetryCodes: ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE'] as const,
    protectedPushHint: protectedBranchTarget
      ? 'Protected framework branches enforce commit-range git-head evidence and may serialize final commit mutation through the branch queue.'
      : null
  };
}

function runGitScalar(cwd: string, args: readonly string[]) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  const value = String(result.stdout ?? '').trim();
  return value.length > 0 ? value : null;
}

function isProtectedFrameworkBranchTarget(branch: string) {
  return branch === 'main'
    || branch === 'master'
    || branch === 'trunk'
    || /^release\/.+/.test(branch);
}

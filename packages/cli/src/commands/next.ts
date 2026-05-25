import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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
import { runDoctor } from './doctor.ts';
import { bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.ts';
import { describeIntegrationInstallHint, inspectIntegrationBootstrap } from './integration.ts';
import { inspectRuntimeAdapterReadiness } from './runtime-adapter-readiness.ts';
import { resolveActorId } from './actor-registry.ts';
import { buildFrameworkTempClaimCommand, createFrameworkModeStatus } from './framework-development.ts';
import {
  buildAllowedFilesForTask,
  createOrRefreshTaskQueue,
  findActiveTaskQueue,
  isTaskDirectionPathCandidate,
  writeTaskDirectionLock
} from './task-direction.ts';
import {
  extractPathLikeStringsFromPrompt,
  isQuickfixPrompt,
  readActiveBatchRun,
  writeBatchRun,
  writeQuickfixLock
} from './work-channels.ts';
import { CliError, makeResult, message, parseJsonText, parseOptions } from './shared.ts';
import { runTasks } from './tasks.ts';

export async function runNext(argv: any) {
  const { options } = parseOptions(argv, 'next');
  const integrationBootstrap = inspectIntegrationBootstrap(options.cwd);
  const runtimeAdapterReadiness = inspectRuntimeAdapterReadiness(options.cwd);
  const taskIntent = resolveTaskIntent(options.cwd, {
    prompt: options.prompt,
    intentPath: options.intent
  });
  const importedTaskQueue = inspectImportedTaskQueue(options.cwd, taskIntent);
  const scopedTargetRepo = importedTaskQueue.promptScope?.targetRepo ?? null;
  const earlyFrameworkStatus = createFrameworkModeStatus({
    cwd: options.cwd,
    targetRepo: scopedTargetRepo
  });
  if (earlyFrameworkStatus.mode === 'cross-repo-target-required') {
    return buildCrossRepoFrameworkNextResult({
      cwd: options.cwd,
      frameworkStatus: earlyFrameworkStatus,
      integrationBootstrap,
      runtimeAdapterReadiness,
      importedTaskQueue
    });
  }
  if (options.claim) {
    return await claimNextImportedTask({
      cwd: options.cwd,
      actor: options.agent,
      taskIntent,
      importedTaskQueue,
      integrationBootstrap,
      runtimeAdapterReadiness
    });
  }
  const promptScopeResult = buildPromptScopedNextResult({
    cwd: options.cwd,
    taskIntent,
    importedTaskQueue,
    integrationBootstrap,
    runtimeAdapterReadiness
  });
  if (promptScopeResult) {
    return promptScopeResult;
  }
  const promptGuidanceResult = buildPromptGuidanceNextResult({
    cwd: options.cwd,
    taskIntent,
    integrationBootstrap,
    runtimeAdapterReadiness
  });
  if (promptGuidanceResult) {
    return promptGuidanceResult;
  }
  const activeGuidanceSession = readActiveGuidanceSession(options.cwd);
  if (activeGuidanceSession) {
    const baseAction = toGuidanceNextAction(activeGuidanceSession.packet, activeGuidanceSession.routeDecision.blockedBy);
    const legacyPlan = activeGuidanceSession.legacyRoutePlan ?? null;
    const nextAction = legacyPlan ? enrichWithLegacyPlan(options.cwd, baseAction, legacyPlan, activeGuidanceSession.sessionId) : baseAction;
    const userNotice = buildFirstUseUserNotice(nextAction);
    return makeResult({
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
    });
  }

  const doctor = await runDoctor(['--cwd', options.cwd]);
  const runtime = detectGovernanceRuntime(options.cwd, bootstrapTaskId);
  const doctorChecks = doctor.evidence.checks as Array<{ name: string; ok: boolean }>;
  const failed = doctorChecks.find((check) => check.ok !== true);
  const nextAction = decideNextAction(runtime, failed?.name ?? null, importedTaskQueue);
  const userNotice = buildFirstUseUserNotice(nextAction);
  return makeResult({
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
  });
}

function decideNextAction(runtime: any, failedCheckName: any, importedTaskQueue: ImportedTaskQueue) {
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
  const userNotice = buildFirstUseUserNotice(nextAction as any);
  return makeResult({
    ok: false,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction as any,
      userNotice,
      input.integrationBootstrap as any,
      input.runtimeAdapterReadiness as any,
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
  readonly taskIntent: TaskIntent | null;
  readonly importedTaskQueue: ImportedTaskQueue;
  readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
  readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}) {
  const promptText = input.taskIntent?.userPrompt?.trim() ?? '';
  const quickfixScope = promptText ? resolveQuickfixScope(promptText) : [];
  if (!input.importedTaskQueue.claimableTask
    && !input.importedTaskQueue.promptScope
    && isQuickfixPrompt(promptText)
    && quickfixScope.length > 0) {
    const resolvedActor = resolveActorId(input.actor ?? undefined);
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
        importedTaskQueue: input.importedTaskQueue,
        integrationBootstrap: input.integrationBootstrap,
        runtimeAdapterReadiness: input.runtimeAdapterReadiness
      }
    });
  }
  if (!input.importedTaskQueue.claimableTask) {
    const claimCode = input.importedTaskQueue.promptScope?.selectedTasks.some((task) => task.format === 'markdown')
      ? 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED'
      : 'ATM_NEXT_CLAIM_NO_TASK';
    const claimText = claimCode === 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED'
      ? 'The prompt-scoped task is a Markdown task card; import or mirror it into the ATM task ledger before claim.'
      : 'No claimable imported task is ready at the moment.';
    return makeResult({
      ok: false,
      command: 'next',
      cwd: input.cwd,
      messages: [message('error', claimCode, claimText, {
        requiredCommand: input.importedTaskQueue.promptScope?.selectedTasks[0]?.sourcePlanPath
          ? `node atm.mjs tasks import --from ${quoteCliValue(input.importedTaskQueue.promptScope.selectedTasks[0].sourcePlanPath ?? '')} --dry-run --cwd . --json`
          : 'node atm.mjs tasks import --from <plan.md> --dry-run --cwd . --json'
      })],
      evidence: {
        taskIntent: input.taskIntent,
        importedTaskQueue: input.importedTaskQueue
      }
    });
  }
  const resolvedActor = resolveActorId(input.actor ?? undefined);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'next --claim requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const existingClaimActorId = input.importedTaskQueue.claimableTask.activeClaimActorId;
  if (existingClaimActorId && existingClaimActorId !== resolvedActor.actorId) {
    throw new CliError('ATM_LOCK_CONFLICT', `Task ${input.importedTaskQueue.claimableTask.workItemId} is already claimed by ${existingClaimActorId}.`, {
      exitCode: 1,
      details: {
        taskId: input.importedTaskQueue.claimableTask.workItemId,
        actorId: existingClaimActorId
      }
    });
  }
  const alreadyClaimedByActor = existingClaimActorId === resolvedActor.actorId;
  const claimPreparation = alreadyClaimedByActor
    ? {
      taskId: input.importedTaskQueue.claimableTask.workItemId,
      originalStatus: normalizeTaskRouteStatus(input.importedTaskQueue.claimableTask.status),
      steps: [],
      reusedActiveClaim: true
    }
    : await prepareImportedTaskForClaim({
      cwd: input.cwd,
      task: input.importedTaskQueue.claimableTask,
      actorId: resolvedActor.actorId
    });
  const claimResult = alreadyClaimedByActor
    ? {
      evidence: {
        action: 'claim',
        taskId: input.importedTaskQueue.claimableTask.workItemId,
        actorId: resolvedActor.actorId,
        reusedActiveClaim: true
      }
    }
    : await runTasks([
      'claim',
      '--cwd',
      input.cwd,
      '--task',
      input.importedTaskQueue.claimableTask.workItemId,
      '--actor',
      resolvedActor.actorId,
      '--files',
      input.importedTaskQueue.claimableTask.taskPath,
      '--json'
    ]);
  const activeQueue = input.importedTaskQueue.promptScope?.status === 'queue'
    ? findActiveTaskQueue(input.cwd, input.taskIntent?.userPrompt ?? input.importedTaskQueue.claimableTask.workItemId) ?? createOrRefreshTaskQueue({
      cwd: input.cwd,
      sourcePrompt: input.taskIntent?.userPrompt ?? input.importedTaskQueue.claimableTask.workItemId,
      tasks: input.importedTaskQueue.promptScope.selectedTasks,
      actorId: resolvedActor.actorId
    })
    : findActiveTaskQueue(input.cwd, input.taskIntent?.userPrompt ?? input.importedTaskQueue.claimableTask.workItemId);
  const directionLock = writeTaskDirectionLock({
    cwd: input.cwd,
    taskId: input.importedTaskQueue.claimableTask.workItemId,
    actorId: resolvedActor.actorId,
    queue: activeQueue,
    allowedFiles: buildAllowedFilesForTask(input.importedTaskQueue.claimableTask),
    prompt: input.taskIntent?.userPrompt ?? input.importedTaskQueue.claimableTask.workItemId
  });
  const batchRun = input.importedTaskQueue.promptScope?.status === 'queue'
    ? writeBatchRun({
      cwd: input.cwd,
      sourcePrompt: input.taskIntent?.userPrompt ?? input.importedTaskQueue.claimableTask.workItemId,
      tasks: input.importedTaskQueue.promptScope.selectedTasks,
      queue: activeQueue,
      actorId: resolvedActor.actorId
    })
    : readActiveBatchRun(input.cwd);
  const nextAction = {
    status: 'ready',
    command: `node atm.mjs start --cwd . --goal ${quoteCliValue(input.importedTaskQueue.claimableTask.title)} --json`,
    reason: `claimed imported work item ${input.importedTaskQueue.claimableTask.workItemId} for ${resolvedActor.actorId}`,
    recommendedChannel: input.importedTaskQueue.promptScope?.status === 'queue' ? 'batch' : 'normal',
    riskLevel: input.importedTaskQueue.promptScope?.status === 'queue' ? 'high' : 'medium',
    selectedTask: input.importedTaskQueue.claimableTask,
    taskContext: {
      scopePaths: input.importedTaskQueue.claimableTask.scopePaths,
      sourcePlanPath: input.importedTaskQueue.claimableTask.sourcePlanPath
    },
    taskDirectionLock: directionLock,
    taskQueue: activeQueue,
    batchRun,
    allowedCommands: allowedGuidanceBootstrapCommands(),
    blockedCommands: blockedMutationCommands()
  };
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
        taskId: input.importedTaskQueue.claimableTask.workItemId,
        actorId: resolvedActor.actorId
      })
    ),
    evidence: {
      nextAction,
      claimPreparation,
      claimResult: claimResult.evidence,
      taskDirectionLock: directionLock,
      taskQueue: activeQueue,
      batchRun,
      recommendedChannel: nextAction.recommendedChannel,
      taskIntent: input.taskIntent,
      importedTaskQueue: input.importedTaskQueue,
      integrationBootstrap: input.integrationBootstrap,
      runtimeAdapterReadiness: input.runtimeAdapterReadiness
    }
  });
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
  if (promptScope.status === 'not-found') {
    const nextAction = {
      status: 'task-scope-not-found',
      command: 'node atm.mjs next --prompt "<current user prompt>" --json',
      reason: 'the prompt mentions task scope, but no matching ATM task card or ledger task was found',
      taskIntent: input.taskIntent,
      candidates: [],
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
        message('error', 'ATM_NEXT_TASK_SCOPE_NOT_FOUND', 'The prompt looks task-scoped, but ATM could not find a matching task.', {
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
    const firstTask = selectedTasks[0] ?? null;
    const queuePrompt = input.taskIntent?.userPrompt ?? firstTask?.workItemId ?? 'prompt-scoped task queue';
    const activeQueue = findActiveTaskQueue(input.cwd, queuePrompt);
    const queueHeadTaskId = activeQueue?.taskIds[activeQueue.currentIndex] ?? firstTask?.workItemId ?? null;
    const queuePreview = {
      schemaId: 'atm.taskQueuePreview.v1',
      sourcePrompt: queuePrompt,
      targetRepo: selectedTasks.find((task) => task.targetRepo)?.targetRepo ?? null,
      taskIds: selectedTasks.map((task) => task.workItemId),
      currentIndex: activeQueue?.currentIndex ?? 0,
      queueHeadTaskId
    };
    const nextAction = {
      status: 'task-queue-ready',
      command: firstTask
        ? `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(queuePrompt)} --json`
        : 'node atm.mjs next --prompt "<current user prompt>" --json',
      reason: 'the prompt resolves to a scoped task queue; claim one task at a time',
      recommendedChannel: 'batch',
      riskLevel: 'high',
      selectedTasks,
      taskQueue: activeQueue ?? queuePreview,
      queueId: activeQueue?.queueId ?? null,
      queueHeadTaskId,
      queueSize: selectedTasks.length,
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
        message('info', 'ATM_NEXT_TASK_QUEUE_READY', 'ATM resolved the prompt to a scoped task queue.', {
          queueSize: selectedTasks.length,
          queueId: activeQueue?.queueId ?? null,
          queueHeadTaskId,
          firstTask: firstTask ? toTaskCandidateView(firstTask) : null
        })
      ),
      evidence: {
        nextAction,
        recommendedChannel: 'batch',
        taskQueue: activeQueue ?? queuePreview,
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
  const nextAction = {
    status: 'task-route-ready',
    command: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(input.taskIntent?.userPrompt ?? selectedTask.workItemId)} --json`,
    reason: `the prompt resolves to task ${selectedTask.workItemId}`,
    recommendedChannel: 'normal',
    riskLevel: 'medium',
    selectedTask,
    targetRepo: selectedTask.targetRepo,
    requiredCommand: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(input.taskIntent?.userPrompt ?? selectedTask.workItemId)} --json`,
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
    allowedCommands: allowedGuidanceBootstrapCommands(),
    blockedCommands: blockedMutationCommands()
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

function isFrameworkMaintenancePrompt(prompt: string) {
  const normalized = normalizeSearchText(prompt);
  return [
    'framework',
    'atm',
    'hook',
    'pre commit',
    'pre tool',
    'baseline',
    'guard',
    'validate',
    'framework mode',
    'integration',
    'runner',
    'governance',
    '治理',
    '框架',
    '基線',
    '防偏移',
    '暫態',
    '鉤子'
  ].some((signal) => normalized.includes(normalizeSearchText(signal)));
}

function allowedGuidanceBootstrapCommands() {
  return [
    'node atm.mjs orient --cwd . --json',
    'node atm.mjs start --cwd . --goal "<goal>" --json',
    'node atm.mjs next --cwd . --json',
    'node atm.mjs explain --why blocked --json'
  ];
}

function blockedMutationCommands() {
  return [
    'host mutation without active guidance session',
    'atomize/infect/split apply without dry-run proposal',
    'apply without human review approval'
  ];
}

type TaskIntentSource = 'integration-hook' | 'atm-skill' | 'cli-deterministic';
type RequestedTaskAction = 'analyze' | 'implement' | 'redo' | 'reopen' | 'close' | 'audit' | 'cleanup';
type PromptScopedRouteStatus = 'ready' | 'queue' | 'ambiguous' | 'not-found';

interface TaskIntent {
  readonly schemaId: 'atm.taskIntent.v1';
  readonly userPrompt: string | null;
  readonly mentionedTaskIds: readonly string[];
  readonly mentionedPlanPaths: readonly string[];
  readonly taskRootHints: readonly string[];
  readonly targetRepoHints: readonly string[];
  readonly requestedAction: RequestedTaskAction | null;
  readonly confidence: number;
  readonly source: TaskIntentSource;
  readonly ordinalScope: { readonly kind: 'first'; readonly count: number } | null;
  readonly queueRequested: boolean;
  readonly taskScopeMentioned: boolean;
}

interface PromptScopedTaskRoute {
  readonly status: PromptScopedRouteStatus;
  readonly selectedTasks: readonly ImportedTaskSummary[];
  readonly targetRepo: string | null;
  readonly diagnostics: readonly string[];
}

interface ImportedTaskSummary {
  readonly workItemId: string;
  readonly title: string;
  readonly status: string;
  readonly milestone: string | null;
  readonly dependencies: readonly string[];
  readonly taskPath: string;
  readonly format: 'json' | 'markdown';
  readonly sourcePlanPath: string | null;
  readonly nearbyPlanPaths: readonly string[];
  readonly scopePaths: readonly string[];
  readonly targetRepo: string | null;
  readonly closureAuthority: string | null;
  readonly activeClaimActorId: string | null;
  readonly matchScore?: number;
  readonly matchReasons?: readonly string[];
}

interface ImportedTaskQueue {
  readonly taskStorePath: string;
  readonly openTaskCount: number;
  readonly selectedTask: ImportedTaskSummary | null;
  readonly claimableTask: ImportedTaskSummary | null;
  readonly tasks: readonly ImportedTaskSummary[];
  readonly promptScope: PromptScopedTaskRoute | null;
}

export interface PromptScopedTaskContext {
  readonly taskIntent: {
    readonly userPrompt: string | null;
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

function inspectImportedTaskQueue(cwd: string, taskIntent: TaskIntent | null): ImportedTaskQueue {
  const taskStorePath = path.join(cwd, '.atm', 'history', 'tasks');
  const jsonTasks = existsSync(taskStorePath) ? readdirSync(taskStorePath)
    .filter((entry) => entry.endsWith('.json'))
    .flatMap((entry): ImportedTaskSummary[] => {
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
        return [{
          workItemId,
          title: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : workItemId,
          status: typeof parsed.status === 'string' ? parsed.status : 'planned',
          milestone: typeof parsed.milestone === 'string' ? parsed.milestone : null,
          dependencies,
          taskPath: path.relative(cwd, filePath).replace(/\\/g, '/'),
          format: 'json',
          sourcePlanPath: normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path),
          nearbyPlanPaths: [],
          scopePaths: uniqueSorted([
            ...readStringArray(parsed.scope),
            ...readStringArray(parsed.scopePaths),
            ...readStringArray(parsed.files),
            ...readStringArray(claimRecord.files),
            ...extractDeclaredTaskPathsFromDocument(parsed)
          ]),
          targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo ?? parsed.upstream_repo ?? parsed.upstreamRepo),
          closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
          activeClaimActorId: claimRecord.state === 'active' && typeof claimRecord.actorId === 'string'
            ? claimRecord.actorId
            : null
        }];
      } catch {
        return [];
      }
    }) : [];
  const markdownTasks = listTaskCardFiles(cwd)
    .map((filePath): ImportedTaskSummary | null => {
      const rawText = readFileSync(filePath, 'utf8');
      const parsed = parseMarkdownFrontmatter(rawText);
      const workItemId = normalizeOptionalString(parsed.task_id ?? parsed.taskId ?? parsed.workItemId ?? parsed.id)
        ?? path.basename(filePath).replace(/\.task\.md$/, '');
      if (!workItemId) return null;
      const dependencies = splitListValue(parsed.dependencies ?? parsed.depends_on ?? parsed.dependsOn);
      const relativeTaskPath = path.relative(cwd, filePath).replace(/\\/g, '/');
      return {
        workItemId,
        title: normalizeOptionalString(parsed.title ?? parsed.name) ?? workItemId,
        status: normalizeOptionalString(parsed.status) ?? 'planned',
        milestone: normalizeOptionalString(parsed.milestone),
        dependencies,
        taskPath: relativeTaskPath,
        format: 'markdown',
        sourcePlanPath: normalizeOptionalString(parsed.plan_path ?? parsed.planPath ?? parsed.source_plan ?? parsed.sourcePlan),
        nearbyPlanPaths: findNearbyPlanPaths(cwd, filePath),
        scopePaths: uniqueSorted([
          ...splitListValue(parsed.scope ?? parsed.scope_paths ?? parsed.scopePaths),
          ...splitListValue(parsed.files ?? parsed.file_paths ?? parsed.filePaths),
          ...splitListValue(parsed.paths),
          ...extractPathLikeStringsFromText(rawText)
        ]),
        targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo ?? parsed.upstream_repo ?? parsed.upstreamRepo),
        closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
        activeClaimActorId: null
      };
    })
    .filter((entry): entry is ImportedTaskSummary => entry !== null);
  const allTasks = dedupeTasks([...jsonTasks, ...markdownTasks]);

  const tasks = allTasks
    .filter((task) => isTaskRoutable(task.status, taskIntent) || isTaskExplicitlyMentioned(task, taskIntent))
    .sort((left, right) => {
      const statusWeight = statusQueueWeight(left.status) - statusQueueWeight(right.status);
      return statusWeight !== 0 ? statusWeight : left.workItemId.localeCompare(right.workItemId);
    });
  const statusById = new Map(allTasks.map((task) => [task.workItemId, task.status]));
  const activeQueue = taskIntent?.userPrompt ? findActiveTaskQueue(cwd, taskIntent.userPrompt) : null;
  const activeQueueTasks = activeQueue
    ? activeQueue.taskIds
      .slice(activeQueue.currentIndex)
      .map((taskId) => tasks.find((task) => task.workItemId === taskId))
      .filter((task): task is ImportedTaskSummary => Boolean(task))
    : [];
  const promptScope = activeQueue && activeQueueTasks.length > 0
    ? {
      status: 'queue' as const,
      selectedTasks: activeQueueTasks,
      targetRepo: activeQueue.targetRepo,
      diagnostics: [`active-queue:${activeQueue.queueId}`, `queue-index:${activeQueue.currentIndex}`]
    }
    : resolvePromptScopedTaskRoute(cwd, tasks, taskIntent);
  const selectedTaskPool = promptScope?.selectedTasks ?? [];
  const selectedTask = selectedTaskPool.find((task) => task.dependencies.every((dependency) => {
    const status = statusById.get(dependency);
    return status === 'done' || status === 'verified';
  })) ?? null;
  const claimableTask = selectedTask && selectedTask.format === 'json' && (canTaskBePreparedForClaim(selectedTask.status) || isTaskAlreadyActivelyClaimed(selectedTask)) && selectedTask.dependencies.every((dependency) => {
    const status = statusById.get(dependency);
    return status === 'done' || status === 'verified';
  }) ? selectedTask : null;

  return {
    taskStorePath: existsSync(taskStorePath) ? path.relative(cwd, taskStorePath).replace(/\\/g, '/') : '.atm/history/tasks',
    openTaskCount: tasks.length,
    selectedTask,
    claimableTask,
    tasks,
    promptScope
  };
}

function statusQueueWeight(status: string): number {
  const normalized = normalizeTaskRouteStatus(status);
  if (normalized === 'ready') return 0;
  if (normalized === 'open') return 1;
  if (normalized === 'planned') return 2;
  if (normalized === 'blocked' || normalized === 'waiting_target_evidence') return 3;
  return 3;
}

function canTaskBePreparedForClaim(status: string) {
  const normalized = normalizeTaskRouteStatus(status);
  return normalized === 'planned'
    || normalized === 'open'
    || normalized === 'reserved'
    || normalized === 'ready';
}

function isTaskAlreadyActivelyClaimed(task: ImportedTaskSummary) {
  return normalizeTaskRouteStatus(task.status) === 'running' && Boolean(task.activeClaimActorId);
}

async function prepareImportedTaskForClaim(input: {
  readonly cwd: string;
  readonly task: ImportedTaskSummary;
  readonly actorId: string;
}) {
  const steps: Array<{ readonly action: 'reserve' | 'promote'; readonly evidence: unknown }> = [];
  const normalizedStatus = normalizeTaskRouteStatus(input.task.status);
  if (normalizedStatus === 'planned' || normalizedStatus === 'open') {
    const reserveResult = await runTasks([
      'reserve',
      '--cwd',
      input.cwd,
      '--task',
      input.task.workItemId,
      '--actor',
      input.actorId,
      '--json'
    ]);
    steps.push({
      action: 'reserve',
      evidence: reserveResult.evidence
    });
  }
  if (normalizedStatus === 'planned' || normalizedStatus === 'open' || normalizedStatus === 'reserved') {
    const promoteResult = await runTasks([
      'promote',
      '--cwd',
      input.cwd,
      '--task',
      input.task.workItemId,
      '--actor',
      input.actorId,
      '--json'
    ]);
    steps.push({
      action: 'promote',
      evidence: promoteResult.evidence
    });
  }
  return {
    taskId: input.task.workItemId,
    originalStatus: normalizedStatus,
    steps
  };
}

function normalizeTaskRouteStatus(status: string) {
  return String(status ?? '').trim().toLowerCase();
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

function resolveTaskIntent(cwd: string, input: { readonly prompt?: string; readonly intentPath?: string }): TaskIntent | null {
  const fileIntent = input.intentPath ? readTaskIntentFile(cwd, input.intentPath) : null;
  if (fileIntent) {
    return {
      ...fileIntent,
      userPrompt: input.prompt ?? fileIntent.userPrompt
    };
  }
  if (input.prompt && input.prompt.trim().length > 0) {
    return createDeterministicTaskIntent(input.prompt);
  }
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

function createDeterministicTaskIntent(prompt: string): TaskIntent {
  const mentionedTaskIds = uniqueSorted((prompt.match(/\b(?:TASK-|ATM-)?[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*-\d{2,}(?:-[A-Z0-9][A-Z0-9-]*)*\b/gi) ?? []).map((entry) => entry.toUpperCase()));
  const mentionedPlanPaths = uniqueSorted(extractPromptPathHints(prompt).filter((entry) => /\.md$/i.test(entry)));
  const targetRepoHints = uniqueSorted([
    ...(/AI-Atomic-Framework|ATM\s*framework|ATM\s*\u6846\u67b6|ATM\u6846\u67b6|\u539f\u5b50\u6846\u67b6/i.test(prompt) ? ['AI-Atomic-Framework'] : [])
  ]);
  const taskRootHints = uniqueSorted([
    ...(/self[-_ ]?atomization|\u81ea\u6211\u539f\u5b50\u5316|100%/i.test(prompt) ? ['atm-self-atomization'] : []),
    ...extractPromptPathHints(prompt).filter((entry) => !/\.md$/i.test(entry))
  ]);
  const ordinalScope = /\u524d\s*(?:3|\u4e09)\s*\u5f35|first\s+3/i.test(prompt)
    ? { kind: 'first' as const, count: 3 }
    : /\u524d\s*(?:2|\u5169|\u4e8c)\s*\u5f35|first\s+2/i.test(prompt)
      ? { kind: 'first' as const, count: 2 }
      : null;
  const queueRequested = Boolean(ordinalScope)
    || /\u5168\u90e8\u4efb\u52d9\u5361|\u6240\u6709\u4efb\u52d9\u5361|\u5168\u90e8\u4efb\u52d9|\u6574\u4efd\u8a08\u756b|\u6574\u500b\u8a08\u756b|all\s+task\s+cards|all\s+tasks|entire\s+plan|whole\s+plan|through\s+all/i.test(prompt);
  const taskScopeMentioned = mentionedTaskIds.length > 0
    || mentionedPlanPaths.length > 0
    || taskRootHints.length > 0
    || queueRequested
    || /\u4efb\u52d9\u5361|task\s*card|task[-_ ]?asa|\u8a08\u756b\u66f8/i.test(prompt);
  return {
    schemaId: 'atm.taskIntent.v1',
    userPrompt: prompt,
    mentionedTaskIds,
    mentionedPlanPaths,
    taskRootHints,
    targetRepoHints,
    requestedAction: detectRequestedTaskAction(prompt),
    confidence: taskScopeMentioned ? 0.7 : 0.25,
    source: 'cli-deterministic',
    ordinalScope,
    queueRequested,
    taskScopeMentioned
  };
}

function normalizeTaskIntent(value: Record<string, unknown>, fallbackSource: TaskIntentSource): TaskIntent {
  const userPrompt = normalizeOptionalString(value.userPrompt);
  const mentionedTaskIds = readStringArray(value.mentionedTaskIds).map((entry) => entry.toUpperCase());
  const mentionedPlanPaths = readStringArray(value.mentionedPlanPaths);
  const taskRootHints = readStringArray(value.taskRootHints);
  const targetRepoHints = readStringArray(value.targetRepoHints);
  const prompt = userPrompt ?? '';
  return {
    schemaId: 'atm.taskIntent.v1',
    userPrompt,
    mentionedTaskIds,
    mentionedPlanPaths,
    taskRootHints,
    targetRepoHints,
    requestedAction: normalizeRequestedTaskAction(value.requestedAction) ?? detectRequestedTaskAction(prompt),
    confidence: typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? Math.max(0, Math.min(1, value.confidence)) : 0.5,
    source: normalizeTaskIntentSource(value.source) ?? fallbackSource,
    ordinalScope: normalizeOrdinalScope(value.ordinalScope),
    queueRequested: value.queueRequested === true || /\u5168\u90e8\u4efb\u52d9\u5361|\u6240\u6709\u4efb\u52d9\u5361|\u5168\u90e8\u4efb\u52d9|\u6574\u4efd\u8a08\u756b|\u6574\u500b\u8a08\u756b|all\s+task\s+cards|all\s+tasks|entire\s+plan|whole\s+plan/i.test(prompt),
    taskScopeMentioned: value.taskScopeMentioned === true
      || mentionedTaskIds.length > 0
      || mentionedPlanPaths.length > 0
      || taskRootHints.length > 0
  };
}

function resolvePromptScopedTaskRoute(cwd: string, tasks: readonly ImportedTaskSummary[], taskIntent: TaskIntent | null): PromptScopedTaskRoute | null {
  if (!taskIntent || !taskIntent.taskScopeMentioned) return null;
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
    return {
      status: 'not-found',
      selectedTasks: [],
      targetRepo: null,
      diagnostics: ['prompt-task-scope-had-no-matching-task-card']
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

function hasRequiredPromptScopeMatch(task: ImportedTaskSummary, intent: TaskIntent): boolean {
  const reasons = task.matchReasons ?? [];
  if (intent.mentionedTaskIds.length > 0) {
    return reasons.includes('task-id-exact');
  }
  if (intent.mentionedPlanPaths.length > 0) {
    return reasons.includes('plan-path-match') || reasons.includes('nearby-plan-name-match');
  }
  if (intent.taskRootHints.length > 0) {
    return reasons.includes('task-root-hint-match') || reasons.includes('nearby-plan-name-match');
  }
  if (intent.targetRepoHints.length > 0) {
    return reasons.includes('target-repo-match');
  }
  return reasons.some((reason) => reason !== 'task-card-surface');
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
    if (normalizedHint && pathFields.some((field) => normalizeSearchText(field).includes(normalizedHint))) {
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

function compareScoredTasks(left: ImportedTaskSummary, right: ImportedTaskSummary): number {
  const scoreDelta = (right.matchScore ?? 0) - (left.matchScore ?? 0);
  if (scoreDelta !== 0) return scoreDelta;
  const statusDelta = statusQueueWeight(left.status) - statusQueueWeight(right.status);
  return statusDelta !== 0 ? statusDelta : left.workItemId.localeCompare(right.workItemId);
}

function resolveRouteTargetRepo(tasks: readonly ImportedTaskSummary[]): string | null {
  const targets = uniqueSorted(tasks.map((task) => task.targetRepo).filter((entry): entry is string => Boolean(entry)));
  return targets.length === 1 ? targets[0] : null;
}

function isTaskRoutable(status: string, intent: TaskIntent | null): boolean {
  const normalized = status.trim().toLowerCase();
  if (intent?.requestedAction === 'redo' || intent?.requestedAction === 'reopen' || intent?.requestedAction === 'audit') {
    return normalized !== 'abandoned' && normalized !== 'cancelled';
  }
  return ['ready', 'open', 'planned', 'blocked', 'waiting_target_evidence', 'reserved'].includes(normalized);
}

function isTaskExplicitlyMentioned(task: ImportedTaskSummary, intent: TaskIntent | null): boolean {
  if (!intent || intent.mentionedTaskIds.length === 0) return false;
  const normalizedStatus = normalizeTaskRouteStatus(task.status);
  if (normalizedStatus === 'done' || normalizedStatus === 'abandoned' || normalizedStatus === 'cancelled') {
    return false;
  }
  return intent.mentionedTaskIds.includes(task.workItemId.toUpperCase());
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

function resolveQuickfixScope(prompt: string) {
  return uniqueSorted([
    ...extractPathLikeStringsFromText(prompt),
    ...extractPathLikeStringsFromPrompt(prompt)
  ]);
}

function normalizeOptionalTaskPath(value: string | null | undefined) {
  const normalized = normalizeOptionalString(value);
  if (!normalized) return null;
  const candidate = normalized.replace(/^[`"'(]+|[`"'):;,]+$/g, '');
  if (!candidate) return null;
  if (/^[A-Za-z]:\//.test(candidate) || candidate.startsWith('http://') || candidate.startsWith('https://')) {
    return null;
  }
  return candidate.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function listTaskCardFiles(cwd: string): readonly string[] {
  return listFilesRecursive(cwd, (filePath) => filePath.endsWith('.task.md'));
}

function listFilesRecursive(directoryPath: string, predicate: (filePath: string) => boolean): readonly string[] {
  if (!existsSync(directoryPath)) return [];
  const stats = statSync(directoryPath);
  if (stats.isFile()) return predicate(directoryPath) ? [directoryPath] : [];
  const ignoredDirs = new Set(['.git', 'node_modules', 'dist', 'build', 'release', '.atm-temp', 'scratch']);
  const output: string[] = [];
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const absolutePath = path.join(directoryPath, entry.name);
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
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.task.md'))
    .map((entry) => path.relative(cwd, path.join(parent, entry.name)).replace(/\\/g, '/'));
}

function parseMarkdownFrontmatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const separatorIndex = rawLine.indexOf(':');
    if (separatorIndex === -1) continue;
    const key = rawLine.slice(0, separatorIndex).trim();
    const value = rawLine.slice(separatorIndex + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

function splitListValue(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value !== 'string') return [];
  return value.split(/[,\s]+/).map((entry) => entry.trim()).filter(Boolean);
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? uniqueSorted(value.map((entry) => String(entry).trim()).filter(Boolean)) : [];
}

function normalizeTaskIntentSource(value: unknown): TaskIntentSource | null {
  return value === 'integration-hook' || value === 'atm-skill' || value === 'cli-deterministic' ? value : null;
}

function normalizeRequestedTaskAction(value: unknown): RequestedTaskAction | null {
  return value === 'analyze' || value === 'implement' || value === 'redo' || value === 'reopen' || value === 'close' || value === 'audit' || value === 'cleanup'
    ? value
    : null;
}

function detectRequestedTaskAction(prompt: string): RequestedTaskAction | null {
  if (/\u91cd\u505a|redo/i.test(prompt)) return 'redo';
  if (/\u91cd\u65b0\u6253\u958b|reopen/i.test(prompt)) return 'reopen';
  if (/\u95dc\u9589|\u5b8c\u6210|close|done/i.test(prompt)) return 'close';
  if (/audit|\u7a3d\u6838|\u6aa2\u8a0e/i.test(prompt)) return 'audit';
  if (/cleanup|\u6e05\u7406/i.test(prompt)) return 'cleanup';
  if (/implement|\u5be6\u4f5c|\u958b\u767c/i.test(prompt)) return 'implement';
  if (/\u5206\u6790|analy[sz]e/i.test(prompt)) return 'analyze';
  return null;
}

function normalizeOrdinalScope(value: unknown): { readonly kind: 'first'; readonly count: number } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.kind !== 'first' || typeof record.count !== 'number' || !Number.isInteger(record.count) || record.count < 1) return null;
  return { kind: 'first', count: Math.min(record.count, 50) };
}

function extractPromptPathHints(prompt: string): readonly string[] {
  const matches = prompt.match(/(?:[A-Za-z]:)?(?:[A-Za-z0-9_%\u4e00-\u9fff() -]+[\\/])+[A-Za-z0-9_%\u4e00-\u9fff(). -]+(?:\.md)?|[A-Za-z0-9_%\u4e00-\u9fff() -]+\.md/gi) ?? [];
  return uniqueSorted(matches
    .map((entry) => entry.trim().replace(/^["'`]+|["'`]+$/g, ''))
    .filter((entry) => entry.length > 2)
    .filter((entry) => /[./\\]|\.md$/i.test(entry)));
}

function pathFieldMatches(field: string, hint: string): boolean {
  const normalizedField = normalizeSearchText(field);
  const normalizedHint = normalizeSearchText(hint);
  const fieldStem = normalizeSearchText(path.basename(field).replace(/\.[^.]+$/, ''));
  const hintStem = normalizeSearchText(path.basename(hint).replace(/\.[^.]+$/, ''));
  return normalizedField.includes(normalizedHint)
    || normalizedHint.includes(normalizedField)
    || Boolean(fieldStem && hintStem && (fieldStem.includes(hintStem) || hintStem.includes(fieldStem)));
}

function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\/g, '/')
    .replace(/%25/g, 'percent')
    .replace(/[ \t\r\n"'`*_~[\]{}<>:\uFF1A,\uFF0C\u3002.!\uFF01?\uFF1F]+/g, '')
    .trim();
}

function countTokenOverlap(prompt: string, title: string): number {
  const promptTokens = new Set(tokenizeForMatch(prompt));
  return tokenizeForMatch(title).filter((token) => promptTokens.has(token)).length;
}

function tokenizeForMatch(value: string): readonly string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length >= 3);
}

function uniqueSorted(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function toTaskCandidateView(task: ImportedTaskSummary) {
  return {
    workItemId: task.workItemId,
    title: task.title,
    status: task.status,
    taskPath: task.taskPath,
    format: task.format,
    sourcePlanPath: task.sourcePlanPath,
    nearbyPlanPaths: task.nearbyPlanPaths,
    scopePaths: task.scopePaths,
    targetRepo: task.targetRepo,
    matchScore: task.matchScore ?? 0,
    matchReasons: task.matchReasons ?? []
  };
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

function compareGuidedLegacyQueuePriority(left: HumanReviewQueueRecord, right: HumanReviewQueueRecord) {
  const statusDelta = humanReviewStatusWeight(left.status) - humanReviewStatusWeight(right.status);
  if (statusDelta !== 0) {
    return statusDelta;
  }
  return compareIsoDesc(left.review?.decidedAt ?? left.queuedAt ?? left.proposal.proposedAt, right.review?.decidedAt ?? right.queuedAt ?? right.proposal.proposedAt);
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

function humanReviewStatusWeight(status: HumanReviewQueueStatus) {
  if (status === 'approved') return 0;
  if (status === 'pending') return 1;
  if (status === 'blocked') return 2;
  return 3;
}

function compareIsoDesc(left: string | undefined, right: string | undefined) {
  const leftValue = left ?? '';
  const rightValue = right ?? '';
  if (leftValue === rightValue) {
    return 0;
  }
  return leftValue > rightValue ? -1 : 1;
}

function dedupeStrings(values: readonly string[]) {
  return Array.from(new Set(values));
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

function quoteCliValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
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

function buildNextMessages(
  nextAction: { readonly status: string },
  userNotice: AtmUserNotice | null,
  integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>,
  runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>,
  routeMessage: ReturnType<typeof message>
) {
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
  messages.push(routeMessage);
  return messages;
}

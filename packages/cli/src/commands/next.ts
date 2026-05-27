import { createHash } from 'node:crypto';
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
import { runDoctor } from './doctor.ts';
import { bootstrapTaskId, detectGovernanceRuntime } from './governance-runtime.ts';
import { describeIntegrationInstallHint, inspectIntegrationBootstrap } from './integration.ts';
import { inspectRuntimeAdapterReadiness } from './runtime-adapter-readiness.ts';
import { resolveActorId } from './actor-registry.ts';
import { resolveActorWorkSession, upsertActorWorkSession } from './actor-session.ts';
import { buildFrameworkTempClaimCommand, createFrameworkModeStatus } from './framework-development.ts';
import { classifyTaskDelivery, type TaskDeliveryClassification } from './task-intent.ts';
import {
  buildAllowedFilesForTask,
  createOrRefreshTaskQueue,
  findActiveTaskQueue,
  isTaskDirectionPathCandidate,
  partitionTaskScope,
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
  writeBatchRun,
  writeQuickfixLock
} from './work-channels.ts';
import { decideActiveBatchClaimTask } from './next-active-batch.ts';
import { CliError, makeResult, message, parseJsonText, parseOptions } from './shared.ts';
import { runTasks } from './tasks.ts';

export async function runNext(argv: any) {
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
  if (!taskIntent && hasPromptScopedWorkItems(importedTaskQueue)) {
    return buildPromptRequiredNextResult({
      cwd: options.cwd,
      claimRequested: Boolean(options.claim),
      importedTaskQueue,
      integrationBootstrap,
      runtimeAdapterReadiness
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
  const resolvedActor = resolveActorId(input.actor ?? undefined, input.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'next --claim requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const activeQueueForIntent = findActiveTaskQueueForIntent(input.cwd, input.taskIntent, {
    taskId: input.importedTaskQueue.claimableTask?.workItemId ?? null
  });
  const activeBatchForIntent = activeQueueForIntent?.batchId
    ? readActiveBatchRun(input.cwd, { batchId: activeQueueForIntent.batchId })
    : findActiveBatchRunForIntent(input.cwd, input.taskIntent, {
      taskId: input.importedTaskQueue.claimableTask?.workItemId ?? null
    });
  assertPromptBatchDoesNotConflict({
    cwd: input.cwd,
    promptScope: input.importedTaskQueue.promptScope,
    allTasks: input.importedTaskQueue.tasks,
    sourcePrompt: input.taskIntent?.userPrompt ?? null,
    currentBatchId: activeBatchForIntent?.batchId ?? null
  });
  let claimableTask = input.importedTaskQueue.claimableTask;
  const activeBatchAtClaimStart = input.importedTaskQueue.promptScope?.status === 'queue'
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
    const batchPromptQueue = inspectImportedTaskQueue(input.cwd, createDeterministicTaskIntent(activeBatchAtClaimStart.sourcePrompt));
    const activeBatchClaimDecision = decideActiveBatchClaimTask({
      activeBatch: activeBatchAtClaimStart,
      activeQueue: activeQueueForIntent
        ?? findActiveTaskQueue(input.cwd, activeBatchAtClaimStart.sourcePrompt, { batchId: activeBatchAtClaimStart.batchId }),
      claimableTask,
      visibleTasks: input.importedTaskQueue.tasks,
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
  const alreadyClaimedByActor = existingClaimActorId === resolvedActor.actorId;
  const claimPreparation = alreadyClaimedByActor
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
  const claimResult = alreadyClaimedByActor
    ? {
      evidence: {
        action: 'claim',
        taskId: claimableTask.workItemId,
        actorId: resolvedActor.actorId,
        reusedActiveClaim: true
      }
    }
    : await runTasks([
      'claim',
      '--cwd',
      input.cwd,
      '--task',
      claimableTask.workItemId,
      '--actor',
      resolvedActor.actorId,
      '--files',
      claimableTask.taskPath,
      '--json'
    ]);
  const activeQueue = input.importedTaskQueue.promptScope?.status === 'queue'
    ? findActiveTaskQueueForIntent(input.cwd, input.taskIntent, { taskId: claimableTask.workItemId }) ?? createOrRefreshTaskQueue({
      cwd: input.cwd,
      sourcePrompt: input.taskIntent?.userPrompt ?? claimableTask.workItemId,
      tasks: input.importedTaskQueue.promptScope.selectedTasks,
      taskIds: input.importedTaskQueue.promptScope.selectedTasks.map((task) => task.workItemId),
      actorId: resolvedActor.actorId
    })
    : findActiveTaskQueue(input.cwd, input.taskIntent?.userPrompt ?? claimableTask.workItemId);
  const inheritedBatchRun = readActiveBatchRun(input.cwd, { taskId: claimableTask.workItemId });
  const batchRun = input.importedTaskQueue.promptScope?.status === 'queue'
    ? activeBatchAtClaimStart?.status === 'active' && activeBatchAtClaimStart.taskIds.includes(claimableTask.workItemId)
      ? activeBatchAtClaimStart
      : writeBatchRun({
        cwd: input.cwd,
        sourcePrompt: input.taskIntent?.userPrompt ?? claimableTask.workItemId,
        tasks: input.importedTaskQueue.promptScope.selectedTasks,
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
  const claimEvidence = claimResult && typeof claimResult === 'object' && 'evidence' in claimResult && claimResult.evidence && typeof claimResult.evidence === 'object'
    ? claimResult.evidence as Record<string, unknown>
    : null;
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
  const teamRecommendation = buildTeamRecommendation({
    taskId: claimableTask.workItemId,
    actorId: resolvedActor.actorId,
    channel: recommendedChannel,
    reason: recommendedChannel === 'batch'
      ? 'Batch queue-head work can use a current-task team, but ATM still owns checkpoint and advance.'
      : 'This task can use an optional team run for role/permission coordination.'
  });
  const nextAction = {
    status: 'ready',
    command: `node atm.mjs start --cwd . --goal ${quoteCliValue(claimableTask.title)} --json`,
    reason: `claimed imported work item ${claimableTask.workItemId} for ${resolvedActor.actorId}`,
    recommendedChannel,
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
    teamRecommendation,
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
      claimPreparation,
      claimResult: claimResult.evidence,
      taskDirectionLock: directionLock,
      taskQueue: activeQueue,
      batchRun,
    teamRecommendation,
      sessionId: actorSession.sessionId,
      actorSession,
      recommendedChannel: nextAction.recommendedChannel,
      taskIntent: input.taskIntent,
      importedTaskQueue: input.importedTaskQueue,
      integrationBootstrap: input.integrationBootstrap,
      runtimeAdapterReadiness: input.runtimeAdapterReadiness
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
    const nextAction = {
      status: 'task-queue-ready',
      command: queueHeadTask
        ? `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(queuePrompt)} --json`
        : 'node atm.mjs next --prompt "<current user prompt>" --json',
      reason: 'the prompt resolves to a scoped task queue; claim one task at a time',
      recommendedChannel: 'batch',
      riskLevel: 'high',
      requiredCommand: queueHeadTask
        ? `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(queuePrompt)} --json`
        : 'node atm.mjs next --prompt "<current user prompt>" --json',
      batchInstruction: 'This is a batch run. Do not switch to per-task normal flow. After next --claim, deliver only the current queue head and run node atm.mjs batch checkpoint --actor <id> --json. Do not manually loop over tasks reserve/promote/claim/close.',
      playbook: buildChannelPlaybook({
        channel: 'batch',
        taskId: queueHeadTaskId ?? undefined,
        queueHeadTaskId,
        originalPrompt: queuePrompt
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
  if (deliveryClassification.intent === 'mirror-sync-only'
    && input.taskIntent?.requestedAction !== 'redo'
    && input.taskIntent?.requestedAction !== 'reopen') {
    const nextAction = buildMirrorSyncNextAction({
      task: selectedTask,
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
          task: toTaskCandidateView(selectedTask),
          classification: deliveryClassification,
          requiredCommand: nextAction.requiredCommand
        })
      ),
      evidence: {
        nextAction,
        recommendedChannel: nextAction.recommendedChannel,
        deliveryClassification,
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
    const nextAction = {
      status: 'task-batch-context-active',
      command: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(activeBatch.sourcePrompt)} --json`,
      reason: `task ${selectedTask.workItemId} belongs to active batch ${activeBatch.batchId}; continue through the current batch queue head`,
      recommendedChannel: 'batch',
      riskLevel: 'high',
      batchInstruction: `This is a batch run. Do not switch to per-task normal flow. Deliver only queue head ${queueHeadTaskId}, then run node atm.mjs batch checkpoint --actor <id> --json to close, advance, and claim the next task.`,
      playbook: buildChannelPlaybook({
        channel: 'batch',
        taskId: queueHeadTaskId ?? selectedTask.workItemId,
        queueHeadTaskId,
        originalPrompt: activeBatch.sourcePrompt
      }),
      deliveryPrinciple: buildTaskDeliveryPrinciple({
        channel: 'batch',
        taskId: queueHeadTaskId ?? selectedTask.workItemId
      }),
      selectedTask,
      targetRepo: selectedTask.targetRepo,
      requiredCommand: `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(activeBatch.sourcePrompt)} --json`,
      taskQueue,
      queueId: activeQueue?.queueId ?? activeBatch.batchId,
      batchId: activeBatch.batchId,
      scopeKey: activeBatch.scopeKey,
      queueHeadTaskId,
      queueSize: activeBatch.taskIds.length,
      activeBatchRunId: activeBatch.batchId,
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
    ? `node atm.mjs next --claim --actor <id> --task ${explicitTaskSelector} --json`
    : `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(input.taskIntent?.userPrompt ?? selectedTask.workItemId)} --json`;
  const nextAction = {
    status: 'task-route-ready',
    command: normalClaimCommand,
    reason: `the prompt resolves to task ${selectedTask.workItemId}`,
    recommendedChannel: 'normal',
    riskLevel: 'medium',
    playbook: buildChannelPlaybook({
      channel: 'normal',
      taskId: selectedTask.workItemId,
      originalPrompt: input.taskIntent?.userPrompt ?? selectedTask.workItemId
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
      playbook: buildChannelPlaybook({
        channel: 'fast',
        originalPrompt: prompt
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
      'node atm.mjs next --claim --actor <id> --prompt "<current user prompt>" --json'
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

type TaskIntentSource = 'integration-hook' | 'atm-skill' | 'cli-deterministic';
type RequestedTaskAction = 'analyze' | 'implement' | 'redo' | 'reopen' | 'close' | 'audit' | 'cleanup';
type PromptScopedRouteStatus = 'ready' | 'queue' | 'ambiguous' | 'not-found';

interface TaskIntent {
  readonly schemaId: 'atm.taskIntent.v1';
  readonly userPrompt: string | null;
  readonly explicitTaskIds: readonly string[];
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
  readonly closedAt: string | null;
  readonly closedByActor: string | null;
  readonly closurePacket: string | null;
  readonly lastTransitionId: string | null;
  readonly lastTransitionAt: string | null;
  readonly milestone: string | null;
  readonly dependencies: readonly string[];
  readonly taskPath: string;
  readonly format: 'json' | 'markdown';
  readonly sourcePlanPath: string | null;
  readonly nearbyPlanPaths: readonly string[];
  readonly scopePaths: readonly string[];
  readonly targetRepo: string | null;
  readonly planningRepo: string | null;
  readonly allowPlanningMirror: boolean;
  readonly planningReadOnlyPaths: readonly string[];
  readonly planningMirrorPaths: readonly string[];
  readonly targetAllowedFiles: readonly string[];
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
          scopePaths: uniqueSorted([
            ...readStringArray(parsed.scope),
            ...readStringArray(parsed.scopePaths),
            ...readStringArray(parsed.files),
            ...readStringArray(claimRecord.files),
            ...extractDeclaredTaskPathsFromDocument(parsed),
            ...extractLinkedSourceTaskArtifactPaths(cwd, normalizeOptionalString(source.planPath ?? parsed.planPath ?? parsed.plan_path))
          ]),
          targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo ?? parsed.upstream_repo ?? parsed.upstreamRepo),
          planningRepo: normalizeOptionalString(parsed.planning_repo ?? parsed.planningRepo),
          allowPlanningMirror: allowsPlanningMirror(parsed),
          closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
          activeClaimActorId: claimRecord.state === 'active' && typeof claimRecord.actorId === 'string'
            ? claimRecord.actorId
            : null
        })];
      } catch {
        return [];
      }
    }) : [];
  const markdownTaskFiles = shouldDiscoverMarkdownTaskCards(taskIntent)
    ? uniqueSorted([
      ...listTaskCardFiles(cwd),
      ...listPromptScopedExternalTaskCardFiles(cwd, taskIntent)
    ])
    : [];
  const markdownTasks = markdownTaskFiles
    .map((filePath): ImportedTaskSummary | null => {
      const rawText = readFileSync(filePath, 'utf8');
      const parsed = parseMarkdownFrontmatter(rawText);
      const workItemId = normalizeOptionalString(parsed.task_id ?? parsed.taskId ?? parsed.workItemId ?? parsed.id)
        ?? path.basename(filePath).replace(/\.task\.md$/, '');
      if (!workItemId) return null;
      const dependencies = splitListValue(parsed.dependencies ?? parsed.depends_on ?? parsed.dependsOn ?? parsed.blocked_by ?? parsed.blockedBy);
      const relativeTaskPath = path.relative(cwd, filePath).replace(/\\/g, '/');
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
        scopePaths: uniqueSorted([
          ...splitListValue(parsed.scope ?? parsed.scope_paths ?? parsed.scopePaths),
          ...splitListValue(parsed.files ?? parsed.file_paths ?? parsed.filePaths),
          ...splitListValue(parsed.allowed_files ?? parsed.allowedFiles),
          ...splitListValue(parsed.deliverables),
          ...splitListValue(parsed.paths),
          ...extractTaskArtifactPathsFromMarkdown(cwd, rawText)
        ]),
        targetRepo: normalizeOptionalString(parsed.target_repo ?? parsed.targetRepo ?? parsed.upstream_repo ?? parsed.upstreamRepo),
        planningRepo: normalizeOptionalString(parsed.planning_repo ?? parsed.planningRepo),
        allowPlanningMirror: allowsPlanningMirror(parsed),
        closureAuthority: normalizeOptionalString(parsed.closure_authority ?? parsed.closureAuthority),
        activeClaimActorId: null
      });
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
    : resolvePromptScopedTaskRoute(cwd, tasks, taskIntent);
  const selectedTaskPool = promptScope?.selectedTasks ?? [];
  const explicitSingleTaskRoute = isExplicitSingleTaskRoute(promptScope, taskIntent);
  const selectedTask = explicitSingleTaskRoute
    ? selectedTaskPool[0] ?? null
    : selectedTaskPool.find((task) => areTaskDependenciesSatisfied(task, statusById)) ?? null;
  const claimableTask = selectedTask
    && selectedTask.format === 'json'
    && (canTaskBePreparedForClaim(selectedTask.status) || isTaskAlreadyActivelyClaimed(selectedTask))
    && (areTaskDependenciesSatisfied(selectedTask, statusById) || explicitSingleTaskRoute || isTaskAlreadyActivelyClaimed(selectedTask))
    ? selectedTask
    : null;

  return {
    taskStorePath: existsSync(taskStorePath) ? path.relative(cwd, taskStorePath).replace(/\\/g, '/') : '.atm/history/tasks',
    openTaskCount: tasks.length,
    selectedTask,
    claimableTask,
    tasks,
    promptScope
  };
}

function hasPromptScopedWorkItems(importedTaskQueue: ImportedTaskQueue) {
  return importedTaskQueue.tasks.some((task) => task.workItemId !== bootstrapTaskId);
}

function isExplicitSingleTaskRoute(promptScope: PromptScopedTaskRoute | null, taskIntent: TaskIntent | null) {
  if (promptScope?.status !== 'ready' || promptScope.selectedTasks.length !== 1 || !taskIntent) return false;
  const selectedTaskId = promptScope.selectedTasks[0]?.workItemId.toUpperCase();
  if (!selectedTaskId) return false;
  return taskIntent.explicitTaskIds.includes(selectedTaskId)
    || taskIntent.mentionedTaskIds.includes(selectedTaskId);
}

function areTaskDependenciesSatisfied(task: ImportedTaskSummary, statusById: ReadonlyMap<string, string>) {
  return task.dependencies.every((dependency) => {
    const status = statusById.get(dependency);
    return status === 'done' || status === 'verified';
  });
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

function isClosedTaskStatus(status: string) {
  const normalized = normalizeTaskRouteStatus(status);
  return normalized === 'done' || normalized === 'verified';
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

function normalizeTaskIntent(value: Record<string, unknown>, fallbackSource: TaskIntentSource): TaskIntent {
  const userPrompt = normalizeOptionalString(value.userPrompt);
  const explicitTaskIds = uniqueInOrder([
    ...readStringArray(value.taskIds),
    ...readStringArray(value.tasks)
  ].map((entry) => entry.toUpperCase()));
  const mentionedTaskIds = uniqueSorted(readStringArray(value.mentionedTaskIds).flatMap((entry) => expandTaskIdReferenceAliases(entry)));
  const mentionedPlanPaths = readStringArray(value.mentionedPlanPaths);
  const taskRootHints = readStringArray(value.taskRootHints);
  const targetRepoHints = readStringArray(value.targetRepoHints);
  const prompt = userPrompt ?? '';
  return {
    schemaId: 'atm.taskIntent.v1',
    userPrompt,
    explicitTaskIds,
    mentionedTaskIds,
    mentionedPlanPaths,
    taskRootHints,
    targetRepoHints,
    requestedAction: normalizeRequestedTaskAction(value.requestedAction) ?? detectRequestedTaskAction(prompt),
    confidence: typeof value.confidence === 'number' && Number.isFinite(value.confidence) ? Math.max(0, Math.min(1, value.confidence)) : 0.5,
    source: normalizeTaskIntentSource(value.source) ?? fallbackSource,
    ordinalScope: normalizeOrdinalScope(value.ordinalScope),
    queueRequested: value.queueRequested === true || isQueueRequestedPrompt(prompt),
    taskScopeMentioned: value.taskScopeMentioned === true
      || explicitTaskIds.length > 0
      || mentionedTaskIds.length > 0
      || mentionedPlanPaths.length > 0
      || taskRootHints.length > 0
  };
}

function resolvePromptScopedTaskRoute(cwd: string, tasks: readonly ImportedTaskSummary[], taskIntent: TaskIntent | null): PromptScopedTaskRoute | null {
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

function hasRequiredPromptScopeMatch(task: ImportedTaskSummary, intent: TaskIntent): boolean {
  const reasons = task.matchReasons ?? [];
  if (intent.mentionedTaskIds.length > 0) {
    if (reasons.includes('task-id-exact')) return true;
    if (intent.queueRequested || intent.ordinalScope) {
      return reasons.includes('task-root-hint-match')
        || reasons.includes('nearby-plan-name-match')
        || reasons.includes('plan-path-match');
    }
    return false;
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

function isTaskCardSurfaceOnlyMatch(task: ImportedTaskSummary): boolean {
  const reasons = task.matchReasons ?? [];
  if (reasons.length === 0) return false;
  return (task.matchScore ?? 0) <= 20 && reasons.every((reason) => reason === 'task-card-surface');
}

function looksLikeNamedPlanPrompt(prompt: string): boolean {
  const normalized = normalizeSearchText(prompt);
  if (!/(?:\u8a08\u756b\u66f8|\u8a08\u756b|\u6587\u4ef6|plan|roadmap|spec|document)/i.test(prompt)) return false;
  return normalized.length >= 10;
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

function isQueueRequestedPrompt(prompt: string): boolean {
  return /\u5168\u90e8(?:[\s\S]{0,80})\u4efb\u52d9\u5361|\u6240\u6709(?:[\s\S]{0,80})\u4efb\u52d9\u5361|\u5168\u90e8(?:[\s\S]{0,80})\u4efb\u52d9|\u5f8c\u9762(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u5f8c\u7e8c(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u5269\u9918(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u63a5\u4e0b\u4f86(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u9010\u4e00(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u4e00\u5f35\u5f35(?:[\s\S]{0,80})(?:\u4efb\u52d9\u5361|\u4efb\u52d9)|\u6574\u4efd\u8a08\u756b|\u6574\u500b\u8a08\u756b|all(?:[\s\S]{0,80})task\s+cards|all(?:[\s\S]{0,80})tasks|remaining(?:[\s\S]{0,80})(?:task\s+cards|tasks)|later(?:[\s\S]{0,80})(?:task\s+cards|tasks)|one\s+by\s+one(?:[\s\S]{0,80})(?:task\s+cards|tasks)|entire\s+plan|whole\s+plan|through\s+all/i.test(prompt);
}

function isTaskExplicitlyMentioned(task: ImportedTaskSummary, intent: TaskIntent | null): boolean {
  if (!intent || intent.mentionedTaskIds.length === 0) return false;
  const normalizedStatus = normalizeTaskRouteStatus(task.status);
  if (normalizedStatus === 'abandoned' || normalizedStatus === 'cancelled') {
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

function shouldDiscoverMarkdownTaskCards(intent: TaskIntent | null): boolean {
  if (!intent) return false;
  return intent.taskScopeMentioned
    || intent.queueRequested
    || intent.mentionedTaskIds.length > 0
    || intent.taskRootHints.length > 0
    || intent.mentionedPlanPaths.length > 0;
}

function finalizeImportedTaskSummary(task: Omit<ImportedTaskSummary, 'planningReadOnlyPaths' | 'planningMirrorPaths' | 'targetAllowedFiles'>): ImportedTaskSummary {
  const partition = partitionTaskScope(task);
  return {
    ...task,
    planningReadOnlyPaths: partition.planningContext.readOnlyPaths,
    planningMirrorPaths: partition.targetWork.planningMirrorPaths,
    targetAllowedFiles: partition.targetWork.allowedFiles
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
    'path-to-atom-map.json'
  ]);
  if (!atomizationCoverageArtifacts.has(basename)) return null;
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

interface PendingTaskArtifactScopeDiagnostic {
  readonly schemaId: 'atm.taskArtifactScopeDiagnostic.v1';
  readonly ignoredUntrackedFiles: readonly string[];
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
  const outsideScope = (entry: string) =>
    !entry.startsWith('.atm/') && !isPathAllowedByScope(entry, allowedFiles);

  const stagedExpansion = stagedOrTracked
    .filter(outsideScope)
    .filter((entry) => looksLikeTaskArtifact(entry, input.task));
  const untrackedExpansion = untracked
    .filter(outsideScope)
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
    ignoredUntrackedFiles: untrackedExpansion
  };
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

function looksLikeTaskArtifact(filePath: string, task: ImportedTaskSummary): boolean {
  const normalized = normalizeOptionalTaskPath(filePath)?.toLowerCase() ?? '';
  if (!normalized) return false;
  if (normalized.startsWith('.git/') || normalized.startsWith('node_modules/')) return false;
  const taskText = [
    task.workItemId,
    task.title,
    task.sourcePlanPath ?? '',
    ...task.scopePaths,
    ...task.targetAllowedFiles
  ].join(' ').toLowerCase();
  const fileTokens = tokenizeForMatch(normalized);
  const taskTokens = new Set(tokenizeForMatch(taskText));
  if (fileTokens.some((token) => taskTokens.has(token))) return true;
  if (normalized.startsWith('atomic_workbench/') && /\batomization\b|generated|fixture|exclusion|dogfood|coverage/.test(taskText)) return true;
  if (normalized.startsWith('docs/ai_atomic_framework/') && task.sourcePlanPath?.includes('docs/ai_atomic_framework/')) return true;
  return false;
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

function listPromptScopedExternalTaskCardFiles(cwd: string, intent: TaskIntent | null): readonly string[] {
  if (!intent?.userPrompt || !intent.taskScopeMentioned) return [];
  const output = new Set<string>();
  for (const root of listCandidatePlanningRoots(cwd)) {
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

function listCandidatePlanningRoots(cwd: string): readonly string[] {
  const roots = new Set<string>();
  for (const configuredRoot of readConfiguredPlanningRoots(cwd)) {
    roots.add(path.isAbsolute(configuredRoot) ? configuredRoot : path.resolve(cwd, configuredRoot));
  }
  roots.add(path.join(cwd, 'docs', 'ai_atomic_framework'));

  const parent = path.dirname(path.resolve(cwd));
  for (const entry of safeReadDir(parent)) {
    if (!entry.isDirectory()) continue;
    roots.add(path.join(parent, entry.name, 'docs', 'ai_atomic_framework'));
  }

  return Array.from(roots)
    .map((entry) => path.resolve(entry))
    .filter((entry) => existsSync(entry))
    .sort((left, right) => left.localeCompare(right));
}

function readConfiguredPlanningRoots(cwd: string): readonly string[] {
  const configPath = path.join(cwd, '.atm', 'config.json');
  if (!existsSync(configPath)) return [];
  try {
    const parsed = parseJsonText(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    const taskLedger = parsed.taskLedger && typeof parsed.taskLedger === 'object' && !Array.isArray(parsed.taskLedger)
      ? parsed.taskLedger as Record<string, unknown>
      : {};
    return readStringArray(taskLedger.planningRoots ?? taskLedger.externalPlanningRoots);
  } catch {
    return [];
  }
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

function parseMarkdownFrontmatter(text: string): Record<string, unknown> {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, unknown> = {};
  let currentListKey: string | null = null;
  for (const rawLine of match[1].split(/\r?\n/)) {
    const listMatch = /^\s*-\s+(.+?)\s*$/.exec(rawLine);
    if (listMatch && currentListKey) {
      const current = Array.isArray(result[currentListKey]) ? result[currentListKey] as string[] : [];
      current.push(listMatch[1].trim());
      result[currentListKey] = current;
      continue;
    }
    const separatorIndex = rawLine.indexOf(':');
    if (separatorIndex === -1) {
      if (rawLine.trim()) currentListKey = null;
      continue;
    }
    const key = rawLine.slice(0, separatorIndex).trim();
    const value = rawLine.slice(separatorIndex + 1).trim();
    if (!key) continue;
    if (!value) {
      result[key] = [];
      currentListKey = key;
      continue;
    }
    result[key] = value;
    currentListKey = null;
  }
  return result;
}

function splitListValue(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return uniqueSorted(value.flatMap((entry) => splitListValue(entry)));
  }
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const inlineArray = /^\[(.*)\]$/.exec(trimmed);
  const source = inlineArray ? inlineArray[1] : trimmed;
  if (source.includes(',') || inlineArray) {
    return uniqueSorted(source
      .split(',')
      .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean));
  }
  return [trimmed.replace(/^['"]|['"]$/g, '')].filter(Boolean);
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function normalizeOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === 'yes' || normalized === 'required' || normalized === 'allow') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === 'deny' || normalized === 'forbid') return false;
  return null;
}

function readStringArray(value: unknown): readonly string[] {
  return splitListValue(value);
}

function allowsPlanningMirror(record: Record<string, unknown>): boolean {
  for (const key of [
    'allow_planning_mirror',
    'allowPlanningMirror',
    'planning_mirror_required',
    'planningMirrorRequired',
    'mirror_required',
    'mirrorRequired',
    'import_required',
    'importRequired'
  ]) {
    const value = normalizeOptionalBoolean(record[key]);
    if (value !== null) return value;
  }
  return false;
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

function uniqueInOrder(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values.map((entry) => String(entry).trim()).filter(Boolean)) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function toTaskCandidateView(task: ImportedTaskSummary) {
  return {
    workItemId: task.workItemId,
    title: task.title,
    status: task.status,
    closedAt: task.closedAt,
    closedByActor: task.closedByActor,
    closurePacket: task.closurePacket,
    lastTransitionId: task.lastTransitionId,
    lastTransitionAt: task.lastTransitionAt,
    taskPath: task.taskPath,
    format: task.format,
    sourcePlanPath: task.sourcePlanPath,
    nearbyPlanPaths: task.nearbyPlanPaths,
    scopePaths: task.scopePaths,
    planningContext: {
      readOnlyPaths: task.planningReadOnlyPaths
    },
    targetWork: {
      allowedFiles: task.targetAllowedFiles,
      allowPlanningMirror: task.allowPlanningMirror
    },
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
      : 'Produce the task deliverables, run required validators, then close with node atm.mjs tasks close --status done.'
  };
}

function buildMirrorSyncNextAction(input: {
  readonly task: ImportedTaskSummary;
  readonly classification: TaskDeliveryClassification;
}) {
  const sourcePath = input.task.sourcePlanPath ?? '<source-task-card-path>';
  const importCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --write --force --json`;
  const dryRunCommand = `node atm.mjs tasks import --from ${quoteCliValue(sourcePath)} --dry-run --json`;
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

function buildChannelPlaybook(input: {
  readonly channel: GovernanceChannel;
  readonly taskId?: string | null;
  readonly originalPrompt?: string | null;
  readonly queueHeadTaskId?: string | null;
  readonly actorPlaceholder?: string;
}) {
  const actor = input.actorPlaceholder ?? '<id>';
  const prompt = input.originalPrompt?.trim() || '<current user prompt>';
  if (input.channel === 'fast') {
    return {
      schemaId: 'atm.channelPlaybook.v1',
      channel: 'fast',
      title: 'Fast quickfix playbook',
      mustFollow: true,
      summary: 'Use this only for small, low-risk edits. It is not a task-card closure path.',
      steps: [
        `Run: node atm.mjs next --claim --actor ${actor} --prompt ${quoteCliValue(prompt)} --json`,
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
        `node atm.mjs next --claim --actor ${actor} --prompt ${quoteCliValue(prompt)} --json`,
        '<edit allowed files>',
        '<run focused validator>',
        'git add <changed files>',
        'git commit -m "<message>"'
      ],
      commitTiming: 'Commit after the focused validator passes.'
    };
  }
  if (input.channel === 'batch') {
    const head = input.queueHeadTaskId ?? input.taskId ?? '<queue-head-task-id>';
    return {
      schemaId: 'atm.channelPlaybook.v1',
      channel: 'batch',
      title: 'Batch queue-head playbook',
      mustFollow: true,
      summary: 'This is a batch run. Do not switch to per-task normal flow. Batch still works one task at a time, but ATM owns the queue, checkpoint, and advance.',
      steps: [
        `Run: node atm.mjs next --claim --actor ${actor} --prompt ${quoteCliValue(prompt)} --json`,
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
      commandSequence: [
        `node atm.mjs next --claim --actor ${actor} --prompt ${quoteCliValue(prompt)} --json`,
        '<implement queue-head deliverables>',
        'node atm.mjs evidence add --task <queue-head-task-id> --actor <id> --kind test --freshness fresh --summary "<what passed>" --artifacts <real-files> --validators <validator-name> --command "<command>" --exit-code 0 --stdout-sha256 sha256:<hash> --stderr-sha256 sha256:<hash> --json',
        'git add <deliverables> .atm/history/evidence/<queue-head-task-id>.json',
        `node atm.mjs batch checkpoint --actor ${actor} --json`,
        'git add .atm/history/tasks/<queue-head-task-id>.json .atm/history/task-events/<queue-head-task-id>/',
        'git commit -m "<scope>: complete <queue-head-task-id>"'
      ],
      commitTiming: 'Stage deliverables before checkpoint; commit once after batch checkpoint succeeds.',
      checkpointCommand: `node atm.mjs batch checkpoint --actor ${actor} --json`
    };
  }
  return {
    schemaId: 'atm.channelPlaybook.v1',
    channel: 'normal',
    title: 'Single-task playbook',
    mustFollow: true,
    summary: 'Use this for one explicit task card. ATM owns the claim and task close sequence.',
    steps: [
      `Run: node atm.mjs next --claim --actor ${actor} --prompt ${quoteCliValue(prompt)} --json`,
      'Work only on the claimed task and its allowed files.',
      'Implement the real non-.atm deliverables.',
      'Run required validators or a focused reproducible verification command.',
      'Add command-backed evidence.',
      `Run: node atm.mjs tasks close --task ${input.taskId ?? '<task-id>'} --actor ${actor} --status done --json`,
      'Commit the deliverables plus matching task/evidence/task-events files.'
    ],
    doNot: [
      'Do not manually reserve/promote/claim before next --claim.',
      'Do not close without real non-.atm deliverables.',
      'Do not commit task closure separately from the deliverable it proves.'
    ],
    commandSequence: [
      `node atm.mjs next --claim --actor ${actor} --prompt ${quoteCliValue(prompt)} --json`,
      '<implement task deliverables>',
      'node atm.mjs evidence add --task <task-id> --actor <id> --kind test --freshness fresh --summary "<what passed>" --artifacts <real-files> --validators <validator-name> --command "<command>" --exit-code 0 --stdout-sha256 sha256:<hash> --stderr-sha256 sha256:<hash> --json',
      `node atm.mjs tasks close --task ${input.taskId ?? '<task-id>'} --actor ${actor} --status done --json`,
      'git add <deliverables> .atm/history/tasks/<task-id>.json .atm/history/evidence/<task-id>.json .atm/history/task-events/<task-id>/',
      'git commit -m "<scope>: complete <task-id>"'
    ],
    commitTiming: 'Commit only after tasks close succeeds.'
  };
}

function buildTeamRecommendation(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly channel: 'normal' | 'batch';
  readonly reason: string;
}) {
  const recipeId = input.channel === 'batch'
    ? 'atm.default.batch'
    : 'atm.default.normal.typescript';
  const quotedTask = quoteCliValue(input.taskId);
  return {
    schemaId: 'atm.teamRecommendation.v1',
    enabled: true,
    required: false,
    channel: input.channel,
    taskId: input.taskId,
    recipeId,
    reason: input.reason,
    planCommand: `node atm.mjs team plan --task ${quotedTask} --recipe ${recipeId} --json`,
    validateCommand: `node atm.mjs team validate --task ${quotedTask} --recipe ${recipeId} --json`,
    startCommand: `node atm.mjs team start --task ${quotedTask} --actor ${input.actorId} --recipe ${recipeId} --json`,
    statusCommand: 'node atm.mjs team status --compact --json',
    constraints: [
      'Team start writes only .atm/runtime/team-runs/<teamRunId>.json.',
      'Team agents are not spawned by this recommendation.',
      'Coordinator remains the only task.lifecycle and git.write owner.'
    ]
  };
}

interface NextDecisionTrailEntry {
  readonly check: string;
  readonly result: 'pass' | 'blocked' | 'info';
  readonly reason: string;
  readonly evidencePath?: string;
  readonly nextCommand?: string;
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
  allowedCommands?: readonly string[];
  blockedCommands?: readonly string[];
  missingEvidence?: readonly string[];
  closure?: { readonly closurePacketPath?: string | null };
  decisionTrail?: NextDecisionTrailEntry[];
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

function decisionResultForStatus(status: string): NextDecisionTrailEntry['result'] {
  if (status === 'prompt-guidance-required') return 'info';
  if (/blocked|required|not-found|selection|repair/i.test(status)) return 'blocked';
  if (/ready|action|closed|claimed|queue/i.test(status)) return 'pass';
  return 'info';
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
  messages.push(routeMessage);
  return messages;
}

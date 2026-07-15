import { existsSync, readFileSync } from 'node:fs';
import { buildFirstUseUserNotice } from '../first-use-notice.ts';
import { type BrokerQueueAdmission } from './broker-queue-admission.ts';
import { runBroker } from '../broker.ts';
import { allowedGuidanceBootstrapCommands, blockedMutationCommands, selectPostClaimChannel } from './channel-strategy.ts';
import { buildTaskScopedClaimCommand } from './task-scoped-claim-command.ts';
import { ensureDecisionTrail, type NextActionLike } from './next-action-assembly.ts';
import { buildPromptScopedQueueClaimCommand } from './prompt-scope-resolution.ts';
import { describeActorResolution, resolveActorId } from '../actor-registry.ts';
import { resolveActorWorkSession, upsertActorWorkSession } from '../actor-session.ts';
import { tryBuildQuickfixClaimResult, buildNoClaimableTaskResult } from './claim-early-results.ts';
import { cleanupPreviousBatchQueueLocks } from './claim-cleanup.ts';
import { assertSourceFirstRunnerReadOnlyAction } from '../framework-development.ts';
import { inspectIntegrationBootstrap } from '../integration.ts';
import { inspectRuntimeAdapterReadiness } from '../runtime-adapter-readiness.ts';
import { classifyTaskDelivery } from '../task-intent.ts';
import { inspectBrokerClaimLifecycle, recordBrokerClaimIntent } from '../../../../core/src/broker/lifecycle.ts';
import { abandonTaskQueue, buildAllowedFilesForTask, createOrRefreshTaskQueue, findActiveTaskQueue, isTaskDirectionPathCandidate, partitionTaskScope, readActiveTaskDirectionLocks, type TaskQueueRecord, writeTaskDirectionLock } from '../task-direction.ts';
import { extractPathLikeStringsFromPrompt, inspectBatchRunConsistency, isQuickfixPrompt, isPathAllowedByScope, listActiveBatchRuns, readActiveBatchRun, repairBatchRunFromQueue, writeBatchRun, writeQuickfixLock } from '../work-channels.ts';
import { buildTeamKnowledgeSummary } from '../team-knowledge.ts';
import { decideActiveBatchClaimTask } from '../next-active-batch.ts';
import { runClaimParallelPreflight } from './claim-parallel-preflight.ts';
import { CliError, makeResult, message, parseJsonText } from '../shared.ts';
import { prepareImportedTaskForClaim, registerPreClaimBrokerTransaction } from './claim-helpers.ts';
import { runTasks, findTaskClaimDependencyBlockers, type TaskClaimDependencyBlocker } from '../tasks/public-surface.ts';
import { taskPathFor } from '../tasks/task-file-io-helpers.ts';
import { normalizeTaskRouteStatus, type TaskIntent } from './intent-normalizers.ts';
import { canTaskBePreparedForClaim, isTaskAlreadyActivelyClaimed, type ImportedTaskQueue, type ImportedTaskSummary } from './route-predicates.ts';
import { quoteCliValue, uniqueSorted } from './view-projections.ts';
import { resolveQuickfixScope, findActiveBatchRunForIntent, findActiveTaskQueueForIntent, assertPromptBatchDoesNotConflict, reconcilePromptScopeRuntimeForClaim, inspectImportedTaskQueue, createDeterministicTaskIntent, checkPendingTaskArtifactScopeExpansion } from './route-resolution.ts';
import { buildActiveWorkSummary, buildChannelPlaybook, buildGovernanceReadinessHint, buildNextMessages, buildTaskDeliveryPrinciple, embedTeamRecommendation, inspectFreshTaskReservationForTask, normalizeWorkPath } from './playbook-projection.ts';
import { diagnoseClaimReadinessForTasks, extractClaimIntentFlag, type NextClaimIntent } from './claim-readiness.ts';
export { diagnoseClaimReadinessForTasks, extractClaimIntentFlag, type ClaimReadinessDiagnostic, type ClaimReadinessReport, type ClaimReadinessTaskSummary, type NextClaimIntent } from './claim-readiness.ts';
export async function claimNextImportedTask(input: { readonly cwd: string; readonly actor: string | undefined; readonly claimIntent?: NextClaimIntent | null; readonly autoIntent?: boolean; readonly forceClaim?: boolean; readonly claimFiles?: readonly string[]; readonly taskIntent: TaskIntent | null; readonly importedTaskQueue: ImportedTaskQueue; readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>; readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>; }) {
  assertSourceFirstRunnerReadOnlyAction({ cwd: input.cwd, action: 'next --claim' });
  const claimStartedAt = Date.now();
  const claimLatencyPhases: Array<{ readonly phase: string; readonly durationMs: number }> = [];
  const claimIntent: NextClaimIntent = input.claimIntent ?? 'write';
  const autoIntent = input.autoIntent !== false && input.claimIntent == null;
  const promptScopeRuntime = input.importedTaskQueue.promptScope?.status === 'queue' ? reconcilePromptScopeRuntimeForClaim(input.cwd, input.taskIntent, input.importedTaskQueue.promptScope.selectedTasks) : null;
  const importedTaskQueue = promptScopeRuntime ? { ...input.importedTaskQueue, claimableTask: promptScopeRuntime.queueHeadTask ?? input.importedTaskQueue.claimableTask, selectedTask: promptScopeRuntime.queueHeadTask ?? input.importedTaskQueue.selectedTask } : input.importedTaskQueue;
  const promptText = input.taskIntent?.userPrompt?.trim() ?? '';
  const quickfixScope = promptText ? resolveQuickfixScope(promptText) : [];
  const quickfixResult = tryBuildQuickfixClaimResult({
    cwd: input.cwd,
    actor: input.actor,
    promptText,
    quickfixScope,
    taskIntent: input.taskIntent,
    importedTaskQueue,
    integrationBootstrap: input.integrationBootstrap,
    runtimeAdapterReadiness: input.runtimeAdapterReadiness
  });
  if (quickfixResult) return quickfixResult;
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
    return buildNoClaimableTaskResult({
      cwd: input.cwd,
      claimIntent,
      importedTaskQueue,
      taskIntent: input.taskIntent
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
  const parallelPreflight = await runClaimParallelPreflight({
    cwd: input.cwd,
    claimableTask,
    actorId: resolvedActor.actorId,
    claimIntent,
    claimAllowedFiles
  });
  parallelAdvisory = parallelPreflight.parallelAdvisory;
  brokerQueueAdmission = parallelPreflight.brokerQueueAdmission;
  claimAllowedFiles = parallelPreflight.claimAllowedFiles;
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

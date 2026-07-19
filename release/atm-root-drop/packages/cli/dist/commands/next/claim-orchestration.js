import { existsSync, readFileSync } from 'node:fs';
import { buildFirstUseUserNotice } from '../first-use-notice.js';
import { runBroker } from '../broker.js';
import { allowedGuidanceBootstrapCommands, blockedMutationCommands, selectPostClaimChannel } from './channel-strategy.js';
import { describeActorResolution } from '../actor-registry.js';
import { resolveActorWorkSession, upsertActorWorkSession } from '../actor-session.js';
import { tryBuildQuickfixClaimResult, buildNoClaimableTaskResult } from './claim-early-results.js';
import { cleanupPreviousBatchQueueLocks } from './claim-cleanup.js';
import { assertSourceFirstRunnerReadOnlyAction } from '../framework-development.js';
import { classifyTaskDelivery } from '../task-intent.js';
import { inspectBrokerClaimLifecycle, recordBrokerClaimIntent } from '../../../../core/dist/broker/lifecycle.js';
import { buildAllowedFilesForTask, createOrRefreshTaskQueue, findActiveTaskQueue, writeTaskDirectionLock } from '../task-direction.js';
import { inspectBatchRunConsistency, readActiveBatchRun, writeBatchRun } from '../work-channels.js';
import { buildTeamKnowledgeSummary } from '../team-knowledge.js';
import { decideActiveBatchClaimTask } from '../next-active-batch.js';
import { runClaimParallelPreflight } from './claim-parallel-preflight.js';
import { buildPlanScopedRoutingPreflight } from './plan-scoped-preflight.js';
import { inspectTouchedPhysicalLineBudget } from '../git-governance/commit-scope-policy.js';
import { CliError, makeResult, message } from '../shared.js';
import { prepareImportedTaskForClaim, registerPreClaimBrokerTransaction } from './claim-helpers.js';
import { runTasks, findTaskClaimDependencyBlockers } from '../tasks/public-surface.js';
import { taskPathFor } from '../tasks/task-file-io-helpers.js';
import { normalizeTaskRouteStatus } from './intent-normalizers.js';
import { isTaskAlreadyActivelyClaimed } from './route-predicates.js';
import { quoteCliValue, uniqueSorted } from './view-projections.js';
import { resolveQuickfixScope, findActiveBatchRunForIntent, findActiveTaskQueueForIntent, assertPromptBatchDoesNotConflict, reconcilePromptScopeRuntimeForClaim, inspectImportedTaskQueue, createDeterministicTaskIntent, checkPendingTaskArtifactScopeExpansion } from './route-resolution.js';
import { buildActiveWorkSummary, buildChannelPlaybook, buildNextMessages, buildTaskDeliveryPrinciple, embedTeamRecommendation, inspectFreshTaskReservationForTask, normalizeWorkPath } from './playbook-projection.js';
import { buildClaimedMessage, normalizeClaimLaneSessionEnvelope, resolveCurrentLaneSessionIdForFreshReservation } from './claim-lane-session.js';
import { evaluateSameTaskClaimOwnership, throwIfNextClaimForeignActiveOwner } from '../tasks/claim-ownership.js';
import { assertClaimLineBudgetOrExtractionAdmission } from './oversized-extraction-admission.js';
import { assertClaimDirtyWipAdmission } from './foreign-dirty-wip-admission.js';
export { diagnoseClaimReadinessForTasks, extractClaimIntentFlag } from './claim-readiness.js';
export async function claimNextImportedTask(input) {
    assertSourceFirstRunnerReadOnlyAction({ cwd: input.cwd, action: 'next --claim' });
    const claimStartedAt = Date.now();
    const claimLatencyPhases = [];
    const claimIntent = input.claimIntent ?? 'write';
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
    if (quickfixResult)
        return quickfixResult;
    const claimDependencyStatusById = new Map(importedTaskQueue.tasks.map((task) => [task.workItemId, task.status]));
    const selectedTask = importedTaskQueue.claimableTask || importedTaskQueue.selectedTask;
    let selectedTaskDependencyBlockers = [];
    if (selectedTask) {
        const taskPath = taskPathFor(input.cwd, selectedTask.workItemId);
        if (existsSync(taskPath)) {
            try {
                const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
                const dependencyClaimFiles = input.claimFiles?.length ? input.claimFiles : buildAllowedFilesForTask(selectedTask);
                selectedTaskDependencyBlockers = findTaskClaimDependencyBlockers(input.cwd, selectedTask.workItemId, taskDocument, { claimFiles: dependencyClaimFiles });
            }
            catch { }
        }
    }
    const requestedLaneSessionIdForReuse = selectedTask
        ? resolveCurrentLaneSessionIdForFreshReservation(input.cwd, input.actor?.trim() ?? '')
        : null;
    const reusesOwnActiveClaim = Boolean(selectedTask && isTaskAlreadyActivelyClaimed(selectedTask)
        && typeof input.actor === 'string' && input.actor.trim().length > 0
        && evaluateSameTaskClaimOwnership({
            currentActorId: selectedTask.activeClaimActorId ?? '',
            currentLaneSessionId: selectedTask.activeClaimLaneSessionId,
            requestedActorId: input.actor.trim(),
            requestedLaneSessionId: requestedLaneSessionIdForReuse
        }).sameOwner);
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
    const currentLaneSessionId = resolveCurrentLaneSessionIdForFreshReservation(input.cwd, resolvedActor.actorId);
    const freshForeignReservation = inspectFreshTaskReservationForTask(input.cwd, claimableTask, resolvedActor.actorId, Date.now(), currentLaneSessionId);
    if (freshForeignReservation && !input.forceClaim) {
        const activeWorkSummary = buildActiveWorkSummary(input.cwd, resolvedActor.actorId, buildAllowedFilesForTask(claimableTask));
        const overrideCommand = `node atm.mjs next --claim --actor ${resolvedActor.actorId} --task ${claimableTask.workItemId} --auto-intent --force --json`;
        throw new CliError('ATM_NEXT_FRESH_FOREIGN_TASK_RESERVED', `Task ${claimableTask.workItemId} was freshly created or imported by ${freshForeignReservation.actorId}; do not auto-claim it as ${resolvedActor.actorId}.`, {
            exitCode: 1,
            details: {
                taskId: claimableTask.workItemId,
                reservedByActorId: freshForeignReservation.actorId,
                reservedByLaneSessionId: freshForeignReservation.laneSessionId,
                currentActorId: resolvedActor.actorId,
                currentLaneSessionId,
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
    const existingClaimLaneSessionId = claimableTask.activeClaimLaneSessionId ?? null;
    const requestedLaneSessionId = currentLaneSessionId;
    const alreadyOwnsActiveClaim = throwIfNextClaimForeignActiveOwner({
        taskId: claimableTask.workItemId,
        existingClaimActorId,
        existingClaimLaneSessionId,
        requestedActorId: resolvedActor.actorId,
        requestedLaneSessionId,
        actorResolution
    });
    let parallelAdvisory = undefined;
    let brokerQueueAdmission = undefined;
    let claimAllowedFiles = (input.claimFiles && input.claimFiles.length > 0)
        ? uniqueSorted(input.claimFiles.map(normalizeWorkPath).filter(Boolean))
        : buildAllowedFilesForTask(claimableTask);
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
    const dirtyWipAdmission = assertClaimDirtyWipAdmission({ cwd: input.cwd, task: claimableTask, actorId: resolvedActor.actorId, laneSessionId: currentLaneSessionId, claimFiles: claimAllowedFiles });
    const planScopedPreflight = buildPlanScopedRoutingPreflight({ cwd: input.cwd, task: claimableTask, selectedTasks: importedTaskQueue.promptScope?.selectedTasks ?? [claimableTask], taskIntent: input.taskIntent, actorId: resolvedActor.actorId, laneSessionId: currentLaneSessionId, dirtyWipAdmission, command: `node atm.mjs next --claim --actor ${resolvedActor.actorId} --task ${claimableTask.workItemId} --auto-intent --json` });
    const lineBudgetReport = inspectTouchedPhysicalLineBudget(input.cwd, claimAllowedFiles, { taskId: claimableTask.workItemId, actorId: resolvedActor.actorId, gate: 'claim' });
    const oversizedExtractionAdmission = assertClaimLineBudgetOrExtractionAdmission({ cwd: input.cwd, taskId: claimableTask.workItemId, taskPath: taskPathFor(input.cwd, claimableTask.workItemId), report: lineBudgetReport });
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
    const alreadyClaimedByActor = alreadyOwnsActiveClaim;
    const activeClaimIntent = claimableTask.activeClaimIntent ?? 'write';
    const shouldReuseActiveClaim = alreadyClaimedByActor
        && (autoIntent || activeClaimIntent === claimIntent);
    let preClaimBrokerTransaction = undefined;
    if (!shouldReuseActiveClaim) {
        const transaction = await registerPreClaimBrokerTransaction({
            cwd: input.cwd,
            taskId: claimableTask.workItemId,
            actorId: resolvedActor.actorId,
            targetFiles: claimAllowedFiles
        });
        preClaimBrokerTransaction = transaction;
        const queueAdmission = transaction.queueAdmission;
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
        const evidence = claimResult.evidence;
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
    const claimEvidence = claimResult && typeof claimResult === 'object' && 'evidence' in claimResult && claimResult.evidence && typeof claimResult.evidence === 'object'
        ? claimResult.evidence
        : null;
    const resolvedClaimIntent = typeof claimEvidence?.claimIntent === 'string'
        ? claimEvidence.claimIntent
        : claimIntent;
    const claimRecord = claimEvidence && typeof claimEvidence.claim === 'object' && claimEvidence.claim
        ? claimEvidence.claim
        : null;
    const rawLaneSession = claimEvidence && typeof claimEvidence.laneSession === 'object' && claimEvidence.laneSession
        ? claimEvidence.laneSession
        : claimRecord && typeof claimRecord.laneSession === 'object' && claimRecord.laneSession
            ? claimRecord.laneSession
            : null;
    const laneSession = normalizeClaimLaneSessionEnvelope(rawLaneSession);
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
        prompt: input.taskIntent?.userPrompt ?? claimableTask.workItemId,
        laneSession
    });
    claimLatencyPhases.push({ phase: 'direction-lock-write', durationMs: Date.now() - directionLockStartedAt });
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
        guidanceSessionId: laneSession?.laneSessionId ?? null
    }).session;
    const laneSessionMessages = Array.isArray(claimResult.messages)
        ? claimResult.messages.filter((entry) => typeof entry?.code === 'string' && entry.code.startsWith('ATM_LANE_SESSION_'))
        : [];
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
        ...(laneSession ? { laneSession } : {}),
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
        channel: recommendedChannel,
        reason: recommendedChannel === 'batch'
            ? 'Batch queue-head work can use a current-task team, but ATM still owns checkpoint and advance.'
            : 'This task can use an optional team run for role/permission coordination.',
        knowledgeSummary: buildTeamKnowledgeSummary({ cwd: input.cwd, taskId: claimableTask.workItemId, top: 3 }),
        parallelAdvisory
    });
    const userNotice = buildFirstUseUserNotice(nextAction);
    return makeResult({
        ok: true,
        command: 'next',
        cwd: input.cwd,
        messages: [
            ...buildNextMessages(nextAction, userNotice, input.integrationBootstrap, input.runtimeAdapterReadiness, buildClaimedMessage({
                taskId: claimableTask.workItemId,
                actorId: resolvedActor.actorId,
                actorSource: resolvedActor.source ?? 'unknown',
                actorResolution,
                recommendedChannel: nextAction.recommendedChannel ?? recommendedChannel,
                claimIntent: resolvedClaimIntent,
                ignoredUntrackedFiles: scopeDiagnostic.ignoredUntrackedFiles
            })),
            ...laneSessionMessages
        ],
        evidence: {
            nextAction,
            ...(laneSession ? { laneSession } : {}),
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
            },
            planScopedPreflight,
            dirtyWipAdmission,
            ...(oversizedExtractionAdmission ? { oversizedExtractionAdmission } : {})
        }
    });
}

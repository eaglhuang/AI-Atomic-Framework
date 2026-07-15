// @ts-nocheck
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { allowedGuidanceBootstrapCommands, blockedMutationCommands } from './channel-strategy.ts';
import { buildTaskScopedClaimCommand } from './task-scoped-claim-command.ts';
import { buildPromptScopedQueueClaimCommand } from './prompt-scope-resolution.ts';
import { buildTeamKnowledgeSummary } from '../team-knowledge.ts';
import { classifyTaskDelivery } from '../task-intent.ts';
import { findActiveTaskQueue } from '../task-direction.ts';
import { inspectBatchRunConsistency, readActiveBatchRun } from '../work-channels.ts';
import { normalizeTaskRouteStatus } from './intent-normalizers.ts';
import { isClosedTaskStatus } from './route-predicates.ts';
import { quoteCliValue, toTaskCandidateView } from './view-projections.ts';
import { makeResult, message } from '../shared.ts';
import {
  buildActiveWorkSummary,
  buildAgentPackHint,
  buildChannelPlaybook,
  buildGovernanceReadinessHint,
  buildMirrorSyncNextAction,
  buildNextMessages,
  buildTaskDeliveryPrinciple,
  embedTeamRecommendation
} from './playbook-projection.ts';
import {
  buildNonPlaybookRouteHints,
  findActiveBatchRunForIntent,
  findActiveTaskQueueForIntent,
  findTaskByTaskIdReference,
  withMirrorSyncOnlyTarget,
  withMirrorSyncOnlyTargetQueue
} from './route-resolution.ts';

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

export function buildPromptScopedNextResult(input: {
  readonly cwd: string;
  readonly actor?: string;
  readonly taskIntent: TaskIntent | null;
  readonly importedTaskQueue: ImportedTaskQueue;
  readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
  readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}) {
  const profile = createNextProfiler('ATM_NEXT_PROMPT_SCOPE_PROFILE');
  const promptScope = input.importedTaskQueue.promptScope;
  if (!promptScope) return null;
  profile.mark('read-prompt-scope');
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
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
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
    if (!planningRootMissing && isReadOnlyPromptScopeMiss(input.taskIntent)) {
      const nextAction = {
        status: 'task-scope-audit-advisory',
        command: 'node atm.mjs next --json',
        reason: 'the prompt mentions a historical or non-ledger task label for read-only audit; ATM did not find a matching open task and will not block safe inspection',
        taskIntent: input.taskIntent,
        candidates: [],
        diagnostics: promptScope.diagnostics,
        decisionTrail: [
          {
            check: 'route-status',
            result: 'info',
            reason: 'ATM found a task-like prompt scope miss, but the requested action is read-only audit/analyze.'
          },
          {
            check: 'prompt-scope-resolution',
            result: 'info',
            reason: 'read-only audit/analyze prompt may inspect evidence without claiming a missing task scope'
          }
        ] satisfies NextDecisionTrailEntry[],
        allowedCommands: allowedGuidanceBootstrapCommands(),
        blockedCommands: blockedMutationCommands(),
        ...nonPlaybookHints
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
          message('info', 'ATM_NEXT_TASK_SCOPE_AUDIT_ADVISORY', 'The prompt names a task-like scope that ATM could not find, but the requested action is read-only audit/analyze.', {
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
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
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
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
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
          input.integrationBootstrap,
          input.runtimeAdapterReadiness,
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
    const queueHeadImport = queueHeadTask ? buildPlanningCardImportRequirement(queueHeadTask) : null;
    const queueClaimCommand = buildPromptScopedQueueClaimCommand({
      queueHeadTaskPresent: Boolean(queueHeadTask),
      queuePrompt,
      planningCardImportCommand: queueHeadImport?.requiredCommand ?? null
    });
    const nextAction = embedTeamRecommendation({
      status: 'task-queue-ready',
      command: queueClaimCommand,
      reason: 'the prompt resolves to a scoped task queue; claim one task at a time',
      recommendedChannel: 'batch',
      riskLevel: 'high',
      requiredCommand: queueClaimCommand,
      planningCardImport: queueHeadImport,
      batchInstruction: 'This is a batch run. Do not switch to per-task normal flow. After next --claim, deliver only the current queue head and run node atm.mjs batch checkpoint --actor <id> --json. Do not manually loop over tasks claim/close.',
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
        actorId: input.actor,
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
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
        message('info', 'ATM_NEXT_TASK_QUEUE_READY', 'ATM resolved the prompt to a scoped task queue.', {
          queueSize: selectedTasks.length,
          queueId: activeBatchQueue?.queueId ?? null,
          queueHeadTaskId,
          firstTask: queueHeadTask ? toTaskCandidateView(queueHeadTask) : null,
          requiredCommand: nextAction.command,
          batchCheckpointCommand: 'node atm.mjs batch checkpoint --actor <id> --json',
          blockedPattern: 'manual tasks claim/close loop',
          planningCardImport: queueHeadImport
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
  profile.mark('select-task');
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
  profile.mark('classify-task-delivery');
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
        nextAction,
        null,
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
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
    const nextAction: NextActionLike = {
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
        nextAction,
        null,
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
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
    const nextAction: NextActionLike = {
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
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
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
  profile.mark('read-active-batch-run');
  if (activeBatch?.status === 'active' && activeBatch.taskIds.includes(selectedTask.workItemId)) {
    const activeQueue = findActiveTaskQueue(input.cwd, activeBatch.sourcePrompt, { batchId: activeBatch.batchId }) ?? findActiveTaskQueue(input.cwd, null, { batchId: activeBatch.batchId });
    const consistency = inspectBatchRunConsistency(activeBatch, activeQueue);
    if (!consistency.ok) {
      const nextAction: NextActionLike = {
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
          input.integrationBootstrap,
          input.runtimeAdapterReadiness,
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
    const nextAction: NextActionLike = embedTeamRecommendation({
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
        actorId: input.actor,
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
        input.integrationBootstrap,
        input.runtimeAdapterReadiness,
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
  const claimCommandContract = buildTaskScopedClaimCommand({
    selectedTaskId: selectedTask.workItemId,
    explicitTaskSelector,
    userPrompt: input.taskIntent?.userPrompt ?? selectedTask.workItemId
  });
  const normalClaimCommand = claimCommandContract?.normalClaimCommand
    ?? `node atm.mjs next --claim --actor <id> --prompt ${quoteCliValue(input.taskIntent?.userPrompt ?? selectedTask.workItemId)} --auto-intent --json`;
  const taskScopedClaimCommand = claimCommandContract?.taskScopedClaimCommand
    ?? `node atm.mjs next --claim --actor <id> --task ${selectedTask.workItemId} --auto-intent --json`;
  profile.mark('build-claim-commands');
  const governanceReadiness = buildGovernanceReadinessHint(input.cwd, {
    channel: 'normal',
    prompt: input.taskIntent?.userPrompt ?? selectedTask.workItemId,
    actorId: input.actor,
    taskId: selectedTask.workItemId
  });
  profile.mark('build-governance-readiness');
  const knowledgeSummary = buildTeamKnowledgeSummary({
    cwd: input.cwd,
    taskId: selectedTask.workItemId,
    top: 3
  });
  profile.mark('build-team-knowledge-summary');
  const planningCardImport = buildPlanningCardImportRequirement(selectedTask);
  const nextAction: NextActionLike = embedTeamRecommendation({
    status: 'task-route-ready',
    command: planningCardImport?.requiredCommand ?? normalClaimCommand,
    reason: `the prompt resolves to task ${selectedTask.workItemId}`,
    recommendedChannel: 'normal',
    riskLevel: 'medium',
    taskScopedClaimCommand,
    claimCommandShape: claimCommandContract?.claimCommandShape ?? (explicitTaskSelector ? 'task-scoped' : 'prompt-scoped'),
    playbook: buildChannelPlaybook({
      channel: 'normal',
      taskId: selectedTask.workItemId,
      originalPrompt: input.taskIntent?.userPrompt ?? selectedTask.workItemId
    }),
    governanceReadiness,
    deliveryPrinciple: buildTaskDeliveryPrinciple({
      channel: 'normal',
      taskId: selectedTask.workItemId
    }),
    selectedTask,
    targetRepo: selectedTask.targetRepo,
    requiredCommand: planningCardImport?.requiredCommand ?? normalClaimCommand,
    planningCardImport,
    allowedCommands: allowedGuidanceBootstrapCommands(),
    blockedCommands: blockedMutationCommands()
  }, {
    taskId: selectedTask.workItemId,
    channel: 'normal',
    knowledgeSummary
  });
  profile.mark('embed-team-recommendation');
  profile.flush('build-normal-task-route-ready');
  return makeResult({
    ok: true,
    command: 'next',
    cwd: input.cwd,
    messages: buildNextMessages(
      nextAction,
      null,
      input.integrationBootstrap,
      input.runtimeAdapterReadiness,
      message('info', 'ATM_NEXT_TASK_ROUTE_READY', 'ATM resolved the prompt to one task route.', {
        task: toTaskCandidateView(selectedTask),
        requiredCommand: nextAction.requiredCommand,
        planningCardImport
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

function isReadOnlyPromptScopeMiss(taskIntent: TaskIntent | null): boolean {
  if (!taskIntent) return false;
  const action: RequestedTaskAction | null = taskIntent.requestedAction;
  return action === 'audit' || action === 'analyze';
}

function buildPlanningCardImportRequirement(task: ImportedTaskSummary | null | undefined) {
  if (!task) return null;
  const taskPath = typeof task.taskPath === 'string' ? task.taskPath : null;
  if (taskPath?.startsWith('.atm/history/tasks/')) return null;
  const importPath = taskPath || task.sourcePlanPath;
  if (!importPath) return null;
  return {
    schemaId: 'atm.planningCardImportRequirement.v1',
    status: 'planning-card-not-in-target-ledger',
    taskId: task.workItemId,
    sourcePlanPath: task.sourcePlanPath,
    taskCardPath: task.taskPath,
    requiredCommand: `node atm.mjs tasks import --from ${quoteCliValue(importPath)} --write --json`,
    dryRunCommand: `node atm.mjs tasks import --from ${quoteCliValue(importPath)} --dry-run --json`,
    reason: 'The prompt resolved to a Markdown planning card, but ATM has no imported target-ledger task for it yet.'
  };
}

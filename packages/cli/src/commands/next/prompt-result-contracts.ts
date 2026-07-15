// @ts-nocheck
import { inspectBatchRunConsistency, readActiveBatchRun } from '../work-channels.ts';
import { findActiveTaskQueue } from '../task-direction.ts';
import { makeResult, message } from '../shared.ts';
import { allowedGuidanceBootstrapCommands, blockedMutationCommands } from './channel-strategy.ts';
import { buildPromptScopedQueueClaimCommand } from './prompt-scope-resolution.ts';
import { buildTeamKnowledgeSummary } from '../team-knowledge.ts';
import {
  buildAgentPackHint,
  buildChannelPlaybook,
  buildGovernanceReadinessHint,
  buildNextMessages,
  buildTaskDeliveryPrinciple,
  embedTeamRecommendation
} from './playbook-projection.ts';
import {
  findActiveBatchRunForIntent,
  findActiveTaskQueueForIntent
} from './route-resolution.ts';
import { quoteCliValue } from './view-projections.ts';

export function createNextProfiler(header = 'ATM_NEXT_PROFILE') {
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

export function buildPlanningCardImportRequirement(task: ImportedTaskSummary | null | undefined) {
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

export function isReadOnlyPromptScopeMiss(taskIntent: TaskIntent | null): boolean {
  if (!taskIntent) return false;
  const action: RequestedTaskAction | null = taskIntent.requestedAction;
  return action === 'audit' || action === 'analyze';
}

export function buildPromptScopeQueueResult(input: {
  readonly cwd: string;
  readonly actor?: string;
  readonly taskIntent: TaskIntent | null;
  readonly importedTaskQueue: ImportedTaskQueue;
  readonly selectedTasks: ImportedTaskSummary[];
  readonly queueHeadTask: ImportedTaskSummary | null;
  readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
  readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}) {
  const requestedQueuePrompt = input.taskIntent?.userPrompt ?? input.queueHeadTask?.workItemId ?? 'prompt-scoped task queue';
  const activeQueue = findActiveTaskQueueForIntent(input.cwd, input.taskIntent, {
    sourcePromptFallback: requestedQueuePrompt,
    taskId: input.queueHeadTask?.workItemId ?? null
  });
  const activeBatch = activeQueue?.batchId
    ? readActiveBatchRun(input.cwd, { batchId: activeQueue.batchId })
    : findActiveBatchRunForIntent(input.cwd, input.taskIntent, {
      sourcePromptFallback: requestedQueuePrompt,
      taskId: input.queueHeadTask?.workItemId ?? null
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
        taskId: input.queueHeadTask?.workItemId ?? null,
        queueHeadTaskId: input.queueHeadTask?.workItemId ?? null,
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
  const queueHeadTaskId = activeBatchQueue?.taskIds[activeBatchQueue.currentIndex] ?? input.queueHeadTask?.workItemId ?? null;
  const queuePreview = {
    schemaId: 'atm.taskQueuePreview.v1',
    sourcePrompt: queuePrompt,
    batchId: activeBatch?.batchId ?? null,
    scopeKey: activeBatch?.scopeKey ?? null,
    targetRepo: input.selectedTasks.find((task) => task.targetRepo)?.targetRepo ?? null,
    taskIds: input.selectedTasks.map((task) => task.workItemId),
    currentIndex: activeBatchQueue?.currentIndex ?? 0,
    queueHeadTaskId
  };
  const queueHeadImport = input.queueHeadTask ? buildPlanningCardImportRequirement(input.queueHeadTask) : null;
  const queueClaimCommand = buildPromptScopedQueueClaimCommand({
    queueHeadTaskPresent: Boolean(input.queueHeadTask),
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
    selectedTasks: input.selectedTasks,
    taskQueue: activeBatchQueue ?? queuePreview,
    queueId: activeBatchQueue?.queueId ?? null,
    batchId: activeBatch?.batchId ?? null,
    scopeKey: activeBatch?.scopeKey ?? null,
    queueHeadTaskId,
    queueSize: input.selectedTasks.length,
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
        queueSize: input.selectedTasks.length,
        queueId: activeBatchQueue?.queueId ?? null,
        queueHeadTaskId,
        firstTask: input.queueHeadTask ? input.queueHeadTask : null,
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

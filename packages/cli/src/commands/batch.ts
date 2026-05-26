import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message, parseOptions } from './shared.ts';
import { resolveActorId } from './actor-registry.ts';
import { runNext } from './next.ts';
import { runTasks } from './tasks.ts';
import { findActiveTaskQueue, partitionTaskScope } from './task-direction.ts';
import {
  activeBatchSelectionStatus,
  inspectBatchRunConsistency,
  listActiveBatchRuns,
  readActiveBatchRun,
  releaseBatchRun,
  repairBatchRunFromQueue,
  updateBatchRun
} from './work-channels.ts';

export async function runBatch(argv: string[]) {
  const { options } = parseOptions(argv, 'batch');
  const action = String(argv[0] ?? 'status').toLowerCase();
  if (action === 'status' || action === 'current') {
    const selector = buildBatchSelector(options);
    const selection = Object.keys(selector).length > 0
      ? activeBatchSelectionStatus(options.cwd, selector)
      : activeBatchSelectionStatus(options.cwd);
    const allActiveBatches = listActiveBatchRuns(options.cwd);
    const batchRun = selection.batchRun;
    const taskQueue = batchRun ? findActiveTaskQueue(options.cwd, batchRun.sourcePrompt, { batchId: batchRun.batchId }) : null;
    const consistency = inspectBatchRunConsistency(batchRun, taskQueue);
    if (!selection.ok && allActiveBatches.length > 1 && Object.keys(selector).length === 0) {
      return makeResult({
        ok: false,
        command: 'batch',
        cwd: options.cwd,
        messages: [message('error', 'ATM_BATCH_SELECTION_REQUIRED', 'Multiple active batch runs exist; choose one with --batch <batchId> or --scope <scopeKey>.', {
          activeBatches: allActiveBatches.map(toBatchCandidate)
        })],
        evidence: {
          action: 'status',
          activeBatches: allActiveBatches,
          selection
        }
      });
    }
    const compact = options.compact === true || action === 'current';
    if (compact) {
      const compactStatus = buildCompactBatchStatus(options.cwd, batchRun, taskQueue, consistency, allActiveBatches.length);
      return makeResult({
        ok: consistency.ok,
        command: 'batch',
        cwd: options.cwd,
        messages: [consistency.ok
          ? message('info', 'ATM_BATCH_CURRENT', batchRun ? 'Current batch queue head resolved.' : 'No active batch run found.', {
            active: Boolean(batchRun),
            batchId: batchRun?.batchId ?? null,
            currentTaskId: batchRun?.currentTaskId ?? null,
            checkpointCommand: batchRun
              ? `node atm.mjs batch checkpoint --actor <id> --batch ${batchRun.batchId} --json`
              : null
          })
          : message('error', 'ATM_BATCH_STATE_REPAIR_REQUIRED', 'Active batch runtime is inconsistent and must be repaired before continuing.', {
            active: Boolean(batchRun),
            batchHeadTaskId: consistency.batchHeadTaskId,
            queueHeadTaskId: consistency.queueHeadTaskId,
            reason: consistency.reason,
            requiredCommand: batchRun
              ? `node atm.mjs batch repair --actor <id> --batch ${batchRun.batchId} --json`
              : 'node atm.mjs batch repair --actor <id> --json'
          })],
        evidence: {
          action,
          compact: true,
          current: compactStatus
        }
      });
    }
    return makeResult({
      ok: consistency.ok,
      command: 'batch',
      cwd: options.cwd,
      messages: [consistency.ok
        ? message('info', 'ATM_BATCH_STATUS', batchRun ? 'Active batch run found.' : 'No active batch run found.', {
        active: Boolean(batchRun),
        batchId: batchRun?.batchId ?? null,
        scopeKey: batchRun?.scopeKey ?? null,
        currentTaskId: batchRun?.currentTaskId ?? null,
        activeBatchCount: allActiveBatches.length
        })
        : message('error', 'ATM_BATCH_STATE_REPAIR_REQUIRED', 'Active batch runtime is inconsistent and must be repaired before continuing.', {
          active: Boolean(batchRun),
          batchHeadTaskId: consistency.batchHeadTaskId,
          queueHeadTaskId: consistency.queueHeadTaskId,
          reason: consistency.reason,
          requiredCommand: 'node atm.mjs batch repair --actor <id> --json'
        })],
      evidence: {
        action: 'status',
        batchRun,
        activeBatches: allActiveBatches,
        taskQueue,
        consistency
      }
    });
  }

  const resolvedActor = resolveActorId(options.agent ?? undefined);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', `batch ${action} requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 });
  }

  if (action === 'checkpoint') {
    const active = selectRequiredBatch(options.cwd, buildBatchSelector(options), resolvedActor.actorId, action);
    if (!active) {
      throw new CliError('ATM_BATCH_RUN_MISSING', 'batch checkpoint requires an active batch run. Start with next --claim on a batch-scoped prompt; batch is for delivering each queue item, not for bulk-closing task cards.', { exitCode: 2 });
    }
    const consistencyQueue = findActiveTaskQueue(options.cwd, active.sourcePrompt, { batchId: active.batchId });
    const consistency = inspectBatchRunConsistency(active, consistencyQueue);
    if (!consistency.ok) {
      throw new CliError('ATM_BATCH_STATE_REPAIR_REQUIRED', 'batch checkpoint cannot continue because batch-run and task-queue runtime disagree.', {
        exitCode: 1,
        details: {
          batchId: active.batchId,
          reason: consistency.reason,
          batchHeadTaskId: consistency.batchHeadTaskId,
          queueHeadTaskId: consistency.queueHeadTaskId,
          requiredCommand: `node atm.mjs batch repair --actor ${resolvedActor.actorId} --batch ${active.batchId} --json`
        }
      });
    }
    const currentTaskId = active.currentTaskId;
    if (!currentTaskId) {
      const completed = releaseBatchRun(options.cwd, active, 'completed');
      return makeResult({
        ok: true,
        command: 'batch',
        cwd: options.cwd,
        messages: [message('info', 'ATM_BATCH_COMPLETED', 'Batch run is already completed.', { batchId: completed.batchId, scopeKey: completed.scopeKey })],
        evidence: {
          action: 'checkpoint',
          batchRun: completed
        }
      });
    }
    const closeResult = await runTasks([
      'close',
      '--cwd',
      options.cwd,
      '--task',
      currentTaskId,
      '--actor',
      resolvedActor.actorId,
      '--status',
      'done',
      '--from-batch-checkpoint',
      '--batch',
      active.batchId,
      '--json'
    ]);
    let cleanupResult: unknown = null;
    try {
      cleanupResult = await runTasks([
        'lock',
        'cleanup',
        '--cwd',
        options.cwd,
        '--task',
        currentTaskId,
        '--actor',
        resolvedActor.actorId,
        '--reason',
        'batch checkpoint cleanup',
        '--json'
      ]);
    } catch {
      cleanupResult = null;
    }
    const queue = findActiveTaskQueue(options.cwd, active.sourcePrompt, { batchId: active.batchId });
    const nextTaskId = queue?.taskIds[queue.currentIndex] ?? null;
    const updated = updateBatchRun(options.cwd, active, {
      currentIndex: queue?.currentIndex ?? active.currentIndex,
      currentTaskId: nextTaskId,
      status: queue?.status === 'completed' || !nextTaskId ? 'completed' : 'active'
    });
    const nextClaim = updated.status === 'active'
      ? await runNext(['--cwd', options.cwd, '--claim', '--actor', resolvedActor.actorId, '--prompt', active.sourcePrompt, '--json'])
      : null;
    if (updated.status === 'completed') {
      releaseBatchRun(options.cwd, updated, 'completed');
    }
    return makeResult({
      ok: true,
      command: 'batch',
      cwd: options.cwd,
      messages: [message('info', 'ATM_BATCH_CHECKPOINT_OK', updated.status === 'completed'
        ? 'Batch checkpoint closed the final task and completed the batch run.'
        : 'Batch checkpoint closed the current task, advanced the batch, and claimed the next queue head.', {
        batchId: updated.batchId,
        closedTaskId: currentTaskId,
        nextTaskId: updated.currentTaskId,
        deliveryPrinciple: 'Batch speed comes from automated queue bookkeeping, not relaxed delivery. Each task still needs real non-.atm deliverables before checkpoint can close it.',
        commitInstruction: `Checkpoint succeeded. Stage .atm/history/tasks/${currentTaskId}.json and .atm/history/task-events/${currentTaskId}/, then create one commit that contains the already staged deliverables, evidence, task file, and task events.`,
        continueInstruction: updated.status === 'completed'
          ? 'Batch is complete after this checkpoint commit.'
          : `This is a batch run. Do not switch to per-task normal flow. After this checkpoint commit, continue with ${updated.currentTaskId} using --batch ${updated.batchId}.`
      }),
      ...(updated.status === 'completed'
        ? []
        : [message('warning', 'ATM_BATCH_CONTEXT_ACTIVE', 'This is a batch run. Do not switch to per-task normal flow.', {
          batchId: updated.batchId,
          currentTaskId: updated.currentTaskId,
          requiredCommand: `node atm.mjs batch checkpoint --actor <id> --batch ${updated.batchId} --json`
        })])],
      evidence: {
        action: 'checkpoint',
        actorId: resolvedActor.actorId,
        closedTaskId: currentTaskId,
        commitInstruction: {
          timing: 'single-commit-after-checkpoint',
          beforeCheckpoint: [
            '<stage deliverables>',
            `.atm/history/evidence/${currentTaskId}.json`
          ],
          files: [
            '<deliverables>',
            `.atm/history/tasks/${currentTaskId}.json`,
            `.atm/history/evidence/${currentTaskId}.json`,
            `.atm/history/task-events/${currentTaskId}/`
          ]
        },
        closeResult: closeResult.evidence,
        cleanupResult: (cleanupResult as { evidence?: unknown } | null)?.evidence ?? null,
        batchRun: updated,
        nextClaim: nextClaim?.evidence ?? null
      }
    });
  }

  if (action === 'repair' || action === 'resume') {
    const active = selectRequiredBatch(options.cwd, buildBatchSelector(options), resolvedActor.actorId, action);
    if (!active) {
      throw new CliError('ATM_BATCH_RUN_MISSING', `batch ${action} requires an active batch run.`, { exitCode: 2 });
    }
    const queue = findActiveTaskQueue(options.cwd, active.sourcePrompt, { batchId: active.batchId });
    const consistency = inspectBatchRunConsistency(active, queue);
    if (!queue) {
      throw new CliError('ATM_BATCH_QUEUE_MISSING', 'Active batch run has no matching active task queue; abandon or recreate the batch from the original prompt.', {
        exitCode: 1,
        details: {
          batchId: active.batchId,
          requiredCommand: `node atm.mjs batch abandon --actor ${resolvedActor.actorId} --batch ${active.batchId} --json`
        }
      });
    }
    const repaired = consistency.ok ? active : repairBatchRunFromQueue(options.cwd, active, queue);
    return makeResult({
      ok: true,
      command: 'batch',
      cwd: options.cwd,
      messages: [
        consistency.ok
          ? message('info', 'ATM_BATCH_REPAIR_NOT_NEEDED', 'Batch runtime is already consistent.', {
            batchId: active.batchId,
            currentTaskId: active.currentTaskId
          })
          : message('info', 'ATM_BATCH_REPAIRED', 'Batch runtime was repaired from the active task queue.', {
            batchId: repaired.batchId,
            previousTaskId: active.currentTaskId,
            currentTaskId: repaired.currentTaskId,
            queueHeadTaskId: queue.taskIds[queue.currentIndex] ?? null
          }),
        message('warning', 'ATM_BATCH_RESUME_INSTRUCTION', 'Resume the batch through the current queue head; do not edit task events by hand.', {
          currentTaskId: repaired.currentTaskId,
          nextCommand: `node atm.mjs next --claim --actor ${resolvedActor.actorId} --prompt "${repaired.sourcePrompt}" --json`,
          checkpointCommand: `node atm.mjs batch checkpoint --actor ${resolvedActor.actorId} --batch ${repaired.batchId} --json`
        })
      ],
      evidence: {
        action,
        actorId: resolvedActor.actorId,
        before: active,
        after: repaired,
        taskQueue: queue,
        consistency
      }
    });
  }

  if (action === 'abandon') {
    const active = selectRequiredBatch(options.cwd, buildBatchSelector(options), resolvedActor.actorId, action);
    if (!active) {
      throw new CliError('ATM_BATCH_RUN_MISSING', 'batch abandon requires an active batch run.', { exitCode: 2 });
    }
    const abandoned = releaseBatchRun(options.cwd, active, 'abandoned');
    return makeResult({
      ok: true,
      command: 'batch',
      cwd: options.cwd,
      messages: [message('info', 'ATM_BATCH_ABANDONED', 'Batch run abandoned.', {
        batchId: abandoned.batchId,
        actorId: resolvedActor.actorId
      })],
      evidence: {
        action: 'abandon',
        actorId: resolvedActor.actorId,
        batchRun: abandoned
      }
    });
  }

  throw new CliError('ATM_CLI_USAGE', 'batch supports: status, current, checkpoint, repair, resume, abandon', { exitCode: 2 });
}

function buildBatchSelector(options: Record<string, any>) {
  const selector: { batchId?: string; scopeKey?: string } = {};
  if (typeof options.batch === 'string' && options.batch.trim()) selector.batchId = options.batch.trim();
  if (typeof options.scope === 'string' && options.scope.trim()) selector.scopeKey = options.scope.trim();
  return selector;
}

function selectRequiredBatch(cwd: string, selector: ReturnType<typeof buildBatchSelector>, actorId: string, action: string) {
  const selection = activeBatchSelectionStatus(cwd, {
    ...selector,
    actorId: selector.batchId || selector.scopeKey ? null : actorId
  });
  if (selection.ok) return selection.batchRun;
  if (selection.reason === 'batch-selection-required') {
    throw new CliError('ATM_BATCH_SELECTION_REQUIRED', `batch ${action} found multiple active batch runs; choose one with --batch <batchId> or --scope <scopeKey>.`, {
      exitCode: 2,
      details: {
        action,
        activeBatches: selection.candidates.map(toBatchCandidate)
      }
    });
  }
  return null;
}

function toBatchCandidate(batchRun: { readonly batchId: string; readonly scopeKey?: string | null; readonly currentTaskId?: string | null; readonly taskIds: readonly string[]; readonly createdByActor?: string | null }) {
  return {
    batchId: batchRun.batchId,
    scopeKey: batchRun.scopeKey ?? null,
    currentTaskId: batchRun.currentTaskId ?? null,
    taskIds: batchRun.taskIds,
    createdByActor: batchRun.createdByActor ?? null,
    checkpointCommand: `node atm.mjs batch checkpoint --actor <id> --batch ${batchRun.batchId} --json`
  };
}

function buildCompactBatchStatus(
  cwd: string,
  batchRun: any,
  taskQueue: any,
  consistency: any,
  activeBatchCount: number
) {
  const queueHead = taskQueue?.tasks?.[taskQueue.currentIndex] ?? null;
  const scope = queueHead ? partitionTaskScope(queueHead) : null;
  const validators = queueHead ? readTaskValidators(cwd, queueHead.taskPath) : [];
  const batchId = batchRun?.batchId ?? null;
  const currentTaskId = batchRun?.currentTaskId ?? taskQueue?.taskIds?.[taskQueue?.currentIndex ?? 0] ?? null;
  return {
    schemaId: 'atm.batchCurrent.v1',
    ok: consistency.ok,
    active: Boolean(batchRun),
    activeBatchCount,
    batchId,
    scopeKey: batchRun?.scopeKey ?? null,
    queueId: taskQueue?.queueId ?? batchRun?.queueId ?? null,
    currentIndex: batchRun?.currentIndex ?? taskQueue?.currentIndex ?? null,
    totalTasks: batchRun?.taskIds?.length ?? taskQueue?.taskIds?.length ?? 0,
    currentTaskId,
    currentTask: queueHead
      ? {
        workItemId: queueHead.workItemId,
        title: queueHead.title,
        taskPath: queueHead.taskPath,
        sourcePlanPath: queueHead.sourcePlanPath,
        targetRepo: queueHead.targetRepo
      }
      : null,
    allowedFiles: scope?.targetWork.allowedFiles ?? [],
    planningReadOnlyPaths: scope?.planningContext.readOnlyPaths ?? [],
    validators,
    checkpointCommand: batchId
      ? `node atm.mjs batch checkpoint --actor <id> --batch ${batchId} --json`
      : null,
    commitInstruction: currentTaskId
      ? {
        timing: 'after-checkpoint',
        files: [
          '<deliverables>',
          `.atm/history/tasks/${currentTaskId}.json`,
          `.atm/history/evidence/${currentTaskId}.json`,
          `.atm/history/task-events/${currentTaskId}/`
        ]
      }
      : null,
    nextCommand: batchRun?.sourcePrompt
      ? `node atm.mjs next --claim --actor <id> --prompt "${batchRun.sourcePrompt}" --json`
      : null,
    repairCommand: batchId
      ? `node atm.mjs batch repair --actor <id> --batch ${batchId} --json`
      : 'node atm.mjs batch repair --actor <id> --json',
    consistency
  };
}

function readTaskValidators(cwd: string, taskPath: string | null | undefined): readonly string[] {
  if (!taskPath) return [];
  const absolutePath = path.isAbsolute(taskPath) ? taskPath : path.resolve(cwd, taskPath);
  if (!existsSync(absolutePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
    const validators = Array.isArray(parsed?.validators) ? parsed.validators : [];
    return validators.map(String).filter(Boolean);
  } catch {
    return [];
  }
}

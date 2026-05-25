import { CliError, makeResult, message, parseOptions } from './shared.ts';
import { resolveActorId } from './actor-registry.ts';
import { runNext } from './next.ts';
import { runTasks } from './tasks.ts';
import { findActiveTaskQueue } from './task-direction.ts';
import {
  inspectBatchRunConsistency,
  readActiveBatchRun,
  releaseBatchRun,
  repairBatchRunFromQueue,
  updateBatchRun
} from './work-channels.ts';

export async function runBatch(argv: string[]) {
  const { options } = parseOptions(argv, 'batch');
  const action = String(argv[0] ?? 'status').toLowerCase();
  if (action === 'status') {
    const batchRun = readActiveBatchRun(options.cwd);
    const taskQueue = batchRun ? findActiveTaskQueue(options.cwd, batchRun.sourcePrompt) : null;
    const consistency = inspectBatchRunConsistency(batchRun, taskQueue);
    return makeResult({
      ok: consistency.ok,
      command: 'batch',
      cwd: options.cwd,
      messages: [consistency.ok
        ? message('info', 'ATM_BATCH_STATUS', batchRun ? 'Active batch run found.' : 'No active batch run found.', {
        active: Boolean(batchRun),
        currentTaskId: batchRun?.currentTaskId ?? null
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
    const active = readActiveBatchRun(options.cwd);
    if (!active) {
      throw new CliError('ATM_BATCH_RUN_MISSING', 'batch checkpoint requires an active batch run. Start with next --claim on a batch-scoped prompt; batch is for delivering each queue item, not for bulk-closing task cards.', { exitCode: 2 });
    }
    const consistencyQueue = findActiveTaskQueue(options.cwd, active.sourcePrompt);
    const consistency = inspectBatchRunConsistency(active, consistencyQueue);
    if (!consistency.ok) {
      throw new CliError('ATM_BATCH_STATE_REPAIR_REQUIRED', 'batch checkpoint cannot continue because batch-run and task-queue runtime disagree.', {
        exitCode: 1,
        details: {
          batchId: active.batchId,
          reason: consistency.reason,
          batchHeadTaskId: consistency.batchHeadTaskId,
          queueHeadTaskId: consistency.queueHeadTaskId,
          requiredCommand: `node atm.mjs batch repair --actor ${resolvedActor.actorId} --json`
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
        messages: [message('info', 'ATM_BATCH_COMPLETED', 'Batch run is already completed.', { batchId: completed.batchId })],
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
    const queue = findActiveTaskQueue(options.cwd, active.sourcePrompt);
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
        commitInstruction: `Checkpoint succeeded. Now commit the deliverables plus .atm/history/tasks/${currentTaskId}.json, .atm/history/evidence/${currentTaskId}.json, and .atm/history/task-events/${currentTaskId}/ together.`,
        continueInstruction: updated.status === 'completed'
          ? 'Batch is complete after this checkpoint commit.'
          : `This is a batch run. Do not switch to per-task normal flow. After this checkpoint commit, continue with ${updated.currentTaskId}.`
      }),
      ...(updated.status === 'completed'
        ? []
        : [message('warning', 'ATM_BATCH_CONTEXT_ACTIVE', 'This is a batch run. Do not switch to per-task normal flow.', {
          batchId: updated.batchId,
          currentTaskId: updated.currentTaskId,
          requiredCommand: 'node atm.mjs batch checkpoint --actor <id> --json'
        })])],
      evidence: {
        action: 'checkpoint',
        actorId: resolvedActor.actorId,
        closedTaskId: currentTaskId,
        commitInstruction: {
          timing: 'after-checkpoint-before-next-task',
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
    const active = readActiveBatchRun(options.cwd);
    if (!active) {
      throw new CliError('ATM_BATCH_RUN_MISSING', `batch ${action} requires an active batch run.`, { exitCode: 2 });
    }
    const queue = findActiveTaskQueue(options.cwd, active.sourcePrompt);
    const consistency = inspectBatchRunConsistency(active, queue);
    if (!queue) {
      throw new CliError('ATM_BATCH_QUEUE_MISSING', 'Active batch run has no matching active task queue; abandon or recreate the batch from the original prompt.', {
        exitCode: 1,
        details: {
          batchId: active.batchId,
          requiredCommand: `node atm.mjs batch abandon --actor ${resolvedActor.actorId} --json`
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
          checkpointCommand: `node atm.mjs batch checkpoint --actor ${resolvedActor.actorId} --json`
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
    const active = readActiveBatchRun(options.cwd);
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

  throw new CliError('ATM_CLI_USAGE', 'batch supports: status, checkpoint, repair, resume, abandon', { exitCode: 2 });
}

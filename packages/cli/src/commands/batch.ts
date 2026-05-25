import { CliError, makeResult, message, parseOptions } from './shared.ts';
import { resolveActorId } from './actor-registry.ts';
import { runNext } from './next.ts';
import { runTasks } from './tasks.ts';
import { findActiveTaskQueue } from './task-direction.ts';
import { readActiveBatchRun, releaseBatchRun, updateBatchRun } from './work-channels.ts';

export async function runBatch(argv: string[]) {
  const { options } = parseOptions(argv, 'batch');
  const action = String(argv[0] ?? 'status').toLowerCase();
  if (action === 'status') {
    const batchRun = readActiveBatchRun(options.cwd);
    const taskQueue = batchRun ? findActiveTaskQueue(options.cwd, batchRun.sourcePrompt) : null;
    return makeResult({
      ok: true,
      command: 'batch',
      cwd: options.cwd,
      messages: [message('info', 'ATM_BATCH_STATUS', batchRun ? 'Active batch run found.' : 'No active batch run found.', {
        active: Boolean(batchRun),
        currentTaskId: batchRun?.currentTaskId ?? null
      })],
      evidence: {
        action: 'status',
        batchRun,
        taskQueue
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
      throw new CliError('ATM_BATCH_RUN_MISSING', 'batch checkpoint requires an active batch run. Start with next --claim on a batch-scoped prompt.', { exitCode: 2 });
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
        : 'Batch checkpoint closed the current task and claimed the next queue head.', {
        batchId: updated.batchId,
        closedTaskId: currentTaskId,
        nextTaskId: updated.currentTaskId
      })],
      evidence: {
        action: 'checkpoint',
        actorId: resolvedActor.actorId,
        closedTaskId: currentTaskId,
        closeResult: closeResult.evidence,
        cleanupResult: (cleanupResult as { evidence?: unknown } | null)?.evidence ?? null,
        batchRun: updated,
        nextClaim: nextClaim?.evidence ?? null
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

  throw new CliError('ATM_CLI_USAGE', 'batch supports: status, checkpoint, abandon', { exitCode: 2 });
}

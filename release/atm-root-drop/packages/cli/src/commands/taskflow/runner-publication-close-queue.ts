import path from 'node:path';
import { enqueueRunnerSyncStewardRequest, type RunnerSyncStewardQueueResult } from '../../../../core/src/broker/runner-sync-steward-queue.ts';
import { resolveRunnerSyncLeaseHealth } from '../framework-development/runner-sync-lease-health.ts';
import { readRunnerSyncStewardQueue, writeRunnerSyncStewardQueue } from '../broker/persistence.ts';

const CLOSE_PUBLICATION_SURFACES = [
  'release/atm-onefile/atm.mjs',
  'release/atm-root-drop',
  'packages/cli/dist'
] as const;

/**
 * Registers a close-ready task in the shared runner publication group.
 *
 * Close callers remain independent until this short shared-write boundary.
 * Requests for the same sealed source coalesce, so one build can emit an
 * attributable receipt for every waiting task. Different source generations
 * remain ordered by the steward queue.
 */
export function enqueueTaskflowClosePublication(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly sealedSourceSha: string;
  readonly ttlSeconds?: number;
}): RunnerSyncStewardQueueResult {
  const queuePath = path.join(input.cwd, '.atm', 'runtime', 'runner-sync-steward-queue.json');
  const result = enqueueRunnerSyncStewardRequest(readRunnerSyncStewardQueue(queuePath), {
    taskId: input.taskId,
    actorId: input.actorId,
    sealedSourceSha: input.sealedSourceSha,
    requestedSurfaces: CLOSE_PUBLICATION_SURFACES,
    ttlSeconds: input.ttlSeconds
  }, {
    taskHealthResolver: (taskId) => resolveRunnerSyncLeaseHealth(input.cwd, taskId)
  });
  writeRunnerSyncStewardQueue(queuePath, result.queue);
  return result;
}


import { enqueueRunnerSyncStewardRequest, type RunnerSyncStewardQueueDocument, type RunnerSyncStewardRequestInput } from '../../../../core/src/broker/runner-sync-steward-queue.ts';

export function supersedeRunnerSyncReservation(queue: RunnerSyncStewardQueueDocument | null | undefined, request: RunnerSyncStewardRequestInput, options: Parameters<typeof enqueueRunnerSyncStewardRequest>[2]) {
  const previous = (queue?.groups ?? []).flatMap((group) => group.requests)
    .filter((entry) => entry.taskId === request.taskId && entry.sealedSourceSha !== request.sealedSourceSha);
  return { ...enqueueRunnerSyncStewardRequest(queue, request, options), supersededReservations: previous };
}

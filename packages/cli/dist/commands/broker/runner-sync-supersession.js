import { enqueueRunnerSyncStewardRequest } from '../../_vendor/core/dist/broker/runner-sync-steward-queue.js';
export function supersedeRunnerSyncReservation(queue, request, options) {
    const previous = (queue?.groups ?? []).flatMap((group) => group.requests)
        .filter((entry) => entry.taskId === request.taskId && entry.sealedSourceSha !== request.sealedSourceSha);
    return { ...enqueueRunnerSyncStewardRequest(queue, request, options), supersededReservations: previous };
}

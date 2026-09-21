import path from 'node:path';
import { enqueueRunnerSyncStewardRequest } from '../../_vendor/core/dist/broker/runner-sync-steward-queue.js';
import { resolveRunnerSyncLeaseHealth } from '../framework-development/runner-sync-lease-health.js';
import { readRunnerSyncStewardQueue, writeRunnerSyncStewardQueue } from '../broker/persistence.js';
const CLOSE_PUBLICATION_SURFACES = [
    'release/atm-onefile/atm.mjs',
    'release/atm-root-drop',
    'packages/cli/dist'
];
/**
 * Registers a close-ready task in the shared runner publication group.
 *
 * Close callers remain independent until this short shared-write boundary.
 * Requests for the same sealed source coalesce, so one build can emit an
 * attributable receipt for every waiting task. Different source generations
 * remain ordered by the steward queue.
 */
export function enqueueTaskflowClosePublication(input) {
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

// @ts-nocheck
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError, makeResult, message } from '../shared.js';
import { cleanupRunnerSyncStewardQueue, enqueueRunnerSyncStewardRequest, explainRunnerSyncStewardPosition, releaseRunnerSyncStewardQueue } from '../../../../core/dist/broker/runner-sync-steward-queue.js';
import { cleanupGeneratedProjectionSteward, enqueueGeneratedProjectionRebuild } from '../../../../core/dist/broker/generated-projection-steward.js';
import { readRunnerSyncStewardQueue, writeRunnerSyncStewardQueue, toRunnerSyncReleaseCliError, readGeneratedProjectionSteward, writeGeneratedProjectionSteward } from './persistence.js';
import { appendLaneSessionEvent } from '../lane-session/events.js';
export function handleBrokerStewardQueues(options, context) {
    const runnerSyncQueuePath = context.runnerSyncQueuePath;
    const projectionStewardPath = context.projectionStewardPath;
    if (options.action === 'runner-sync') {
        if (options.runnerSyncAction === 'enqueue') {
            if (!options.task) {
                throw new CliError('ATM_CLI_USAGE', 'broker runner-sync enqueue requires --task <task-id>.', { exitCode: 2 });
            }
            if (!options.actorId) {
                throw new CliError('ATM_CLI_USAGE', 'broker runner-sync enqueue requires --actor <actor-id>.', { exitCode: 2 });
            }
            if (!options.sealedSourceSha) {
                throw new CliError('ATM_CLI_USAGE', 'broker runner-sync enqueue requires --sealed-source-sha <sha>.', { exitCode: 2 });
            }
            if (options.surfaces.length === 0) {
                throw new CliError('ATM_CLI_USAGE', 'broker runner-sync enqueue requires at least one --surface <path>.', { exitCode: 2 });
            }
            let result;
            try {
                result = enqueueRunnerSyncStewardRequest(readRunnerSyncStewardQueue(runnerSyncQueuePath), {
                    taskId: options.task,
                    actorId: options.actorId,
                    sealedSourceSha: options.sealedSourceSha,
                    requestedSurfaces: options.surfaces,
                    ttlSeconds: options.ttlSeconds
                }, {
                    taskHealthResolver: (taskId) => resolveRunnerSyncTaskIdHealth(options.cwd, taskId)
                });
            }
            catch (error) {
                throw toRunnerSyncQueueCliError(error);
            }
            writeRunnerSyncStewardQueue(runnerSyncQueuePath, result.queue);
            const laneEvent = appendBrokerTicketLaneEvent(options.cwd, options.actorId, result.brokerTicket);
            return makeResult({
                ok: true,
                command: 'broker',
                cwd: options.cwd,
                messages: [
                    message('info', 'ATM_BROKER_RUNNER_SYNC_ENQUEUED', `Runner-sync request is ${result.status} at position ${result.queuePosition} for steward work ${result.stewardWorkId}.`, {
                        status: result.status,
                        queuePosition: result.queuePosition,
                        queueHeadHealth: result.queueHeadHealth,
                        stewardWorkId: result.stewardWorkId,
                        waitingTasks: result.waitingTasks,
                        brokerTicket: result.brokerTicket,
                        suggestedNextAction: result.suggestedNextAction
                    })
                ],
                evidence: {
                    runnerSyncStewardQueuePath: '.atm/runtime/runner-sync-steward-queue.json',
                    runnerSync: result,
                    brokerTicket: result.brokerTicket,
                    laneSessionEvent: laneEvent
                }
            });
        }
        if (options.runnerSyncAction === 'status') {
            const queue = readRunnerSyncStewardQueue(runnerSyncQueuePath);
            const position = options.task
                ? explainRunnerSyncStewardPosition(queue, options.task, new Date().toISOString(), {
                    taskHealthResolver: (request) => resolveRunnerSyncTaskHealth(options.cwd, request)
                })
                : null;
            return makeResult({
                ok: true,
                command: 'broker',
                cwd: options.cwd,
                messages: [
                    message('info', 'ATM_BROKER_RUNNER_SYNC_STATUS', `Runner-sync steward queue contains ${queue.groups.length} steward work item(s).`)
                ],
                evidence: {
                    runnerSyncStewardQueuePath: '.atm/runtime/runner-sync-steward-queue.json',
                    queue,
                    position
                }
            });
        }
        if (options.runnerSyncAction === 'cleanup') {
            const cleanup = cleanupRunnerSyncStewardQueue(readRunnerSyncStewardQueue(runnerSyncQueuePath), new Date().toISOString(), {
                taskHealthResolver: (request) => resolveRunnerSyncTaskHealth(options.cwd, request)
            });
            writeRunnerSyncStewardQueue(runnerSyncQueuePath, cleanup.queue);
            return makeResult({
                ok: true,
                command: 'broker',
                cwd: options.cwd,
                messages: [
                    message('info', 'ATM_BROKER_RUNNER_SYNC_CLEANUP', `Runner-sync steward cleanup released ${cleanup.staleReleases.length} stale request(s).`, {
                        staleReleases: cleanup.staleReleases
                    })
                ],
                evidence: {
                    runnerSyncStewardQueuePath: '.atm/runtime/runner-sync-steward-queue.json',
                    cleanup
                }
            });
        }
        if (options.runnerSyncAction === 'release') {
            if (!options.task) {
                throw new CliError('ATM_CLI_USAGE', 'broker runner-sync release requires --task <task-id>.', { exitCode: 2 });
            }
            if (!options.stewardWorkId) {
                throw new CliError('ATM_CLI_USAGE', 'broker runner-sync release requires --steward-work-id <id>.', { exitCode: 2 });
            }
            try {
                const release = releaseRunnerSyncStewardQueue(readRunnerSyncStewardQueue(runnerSyncQueuePath), {
                    taskId: options.task,
                    stewardWorkId: options.stewardWorkId,
                    receiptRef: options.receiptRef,
                    receiptDigest: options.receiptDigest
                });
                writeRunnerSyncStewardQueue(runnerSyncQueuePath, release.queue);
                return makeResult({
                    ok: true,
                    command: 'broker',
                    cwd: options.cwd,
                    messages: [
                        message('info', 'ATM_BROKER_RUNNER_SYNC_RELEASED', `Runner-sync steward work ${release.released.stewardWorkId} released for ${release.released.waitingTasks.length} waiting task(s).`, {
                            stewardWorkId: release.released.stewardWorkId,
                            waitingTasks: release.released.waitingTasks,
                            nextStewardWorkId: release.next?.stewardWorkId ?? null,
                            suggestedNextAction: release.suggestedNextAction
                        })
                    ],
                    evidence: {
                        runnerSyncStewardQueuePath: '.atm/runtime/runner-sync-steward-queue.json',
                        release
                    }
                });
            }
            catch (error) {
                throw toRunnerSyncReleaseCliError(error);
            }
        }
        throw new CliError('ATM_CLI_USAGE', 'broker runner-sync supports: enqueue, status, cleanup, release', { exitCode: 2 });
    }
    if (options.action === 'projection') {
        if (options.projectionAction === 'enqueue') {
            if (!options.task) {
                throw new CliError('ATM_CLI_USAGE', 'broker projection enqueue requires --task <task-id>.', { exitCode: 2 });
            }
            if (!options.actorId) {
                throw new CliError('ATM_CLI_USAGE', 'broker projection enqueue requires --actor <actor-id>.', { exitCode: 2 });
            }
            if (!options.projectionKey) {
                throw new CliError('ATM_CLI_USAGE', 'broker projection enqueue requires --projection-key <key>.', { exitCode: 2 });
            }
            if (options.sourceItems.length === 0) {
                throw new CliError('ATM_CLI_USAGE', 'broker projection enqueue requires at least one --source-item <path>.', { exitCode: 2 });
            }
            const result = enqueueGeneratedProjectionRebuild(readGeneratedProjectionSteward(projectionStewardPath), {
                taskId: options.task,
                actorId: options.actorId,
                projectionKey: options.projectionKey,
                sourceItemPaths: options.sourceItems,
                ttlSeconds: options.ttlSeconds
            });
            writeGeneratedProjectionSteward(projectionStewardPath, result.queue);
            const laneEvent = appendBrokerTicketLaneEvent(options.cwd, options.actorId, result.brokerTicket);
            return makeResult({
                ok: true,
                command: 'broker',
                cwd: options.cwd,
                messages: [
                    message('info', 'ATM_BROKER_PROJECTION_ENQUEUED', `Generated projection rebuild for ${result.projectionKey} is at position ${result.queuePosition}; owner is ${result.ownerTaskId}.`, {
                        projectionKey: result.projectionKey,
                        ownerTaskId: result.ownerTaskId,
                        queuePosition: result.queuePosition,
                        brokerTicket: result.brokerTicket,
                        suggestedNextAction: result.suggestedNextAction
                    })
                ],
                evidence: {
                    generatedProjectionStewardPath: '.atm/runtime/generated-projection-steward.json',
                    projection: result,
                    brokerTicket: result.brokerTicket,
                    laneSessionEvent: laneEvent
                }
            });
        }
        if (options.projectionAction === 'status') {
            const queue = readGeneratedProjectionSteward(projectionStewardPath);
            return makeResult({
                ok: true,
                command: 'broker',
                cwd: options.cwd,
                messages: [
                    message('info', 'ATM_BROKER_PROJECTION_STATUS', `Generated projection steward contains ${queue.queues.length} projection queue(s).`)
                ],
                evidence: {
                    generatedProjectionStewardPath: '.atm/runtime/generated-projection-steward.json',
                    queue
                }
            });
        }
        if (options.projectionAction === 'cleanup') {
            const cleanup = cleanupGeneratedProjectionSteward(readGeneratedProjectionSteward(projectionStewardPath));
            writeGeneratedProjectionSteward(projectionStewardPath, cleanup.queue);
            return makeResult({
                ok: true,
                command: 'broker',
                cwd: options.cwd,
                messages: [
                    message('info', 'ATM_BROKER_PROJECTION_CLEANUP', `Generated projection steward cleanup released ${cleanup.staleReleases.length} stale request(s).`, {
                        staleReleases: cleanup.staleReleases
                    })
                ],
                evidence: {
                    generatedProjectionStewardPath: '.atm/runtime/generated-projection-steward.json',
                    cleanup
                }
            });
        }
        throw new CliError('ATM_CLI_USAGE', 'broker projection supports: enqueue, status, cleanup', { exitCode: 2 });
    }
    return null;
}
function appendBrokerTicketLaneEvent(cwd, actorId, brokerTicket) {
    const laneId = process.env.ATM_LANE_SESSION_ID?.trim();
    if (!laneId)
        return null;
    try {
        return appendLaneSessionEvent({
            cwd,
            laneId,
            action: 'broker-ticket-enqueued',
            actorId: actorId ?? null,
            details: { brokerTicket }
        });
    }
    catch {
        return null;
    }
}
function resolveRunnerSyncTaskHealth(cwd, request) {
    return resolveRunnerSyncTaskIdHealth(cwd, request.taskId);
}
function resolveRunnerSyncTaskIdHealth(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath)) {
        return 'task-missing';
    }
    try {
        const task = JSON.parse(readFileSync(taskPath, 'utf8'));
        const status = typeof task.status === 'string' ? task.status.trim().toLowerCase() : '';
        return status === 'done' || status === 'verified' || status === 'abandoned'
            ? 'task-terminal'
            : 'task-active';
    }
    catch {
        return 'task-active';
    }
}
function toRunnerSyncQueueCliError(error) {
    const messageText = error instanceof Error ? error.message : String(error ?? '');
    const match = /^(ATM_[A-Z0-9_]+):\s*(.+)$/.exec(messageText);
    if (match) {
        return new CliError(match[1], match[2], { exitCode: 1 });
    }
    return new CliError('ATM_RUNNER_SYNC_QUEUE_FAILED', messageText || 'Runner-sync steward queue operation failed.', { exitCode: 1 });
}

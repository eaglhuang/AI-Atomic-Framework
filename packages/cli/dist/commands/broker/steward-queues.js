// @ts-nocheck
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
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
                    sealedSourceSha: resolveFullGitCommitSha(options.cwd, options.sealedSourceSha),
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
                const queue = readRunnerSyncStewardQueue(runnerSyncQueuePath);
                const receipt = validateRunnerSyncReleaseReceipt({
                    cwd: options.cwd,
                    queue,
                    taskId: options.task,
                    stewardWorkId: options.stewardWorkId,
                    receiptRef: options.receiptRef,
                    receiptDigest: options.receiptDigest
                });
                const release = releaseRunnerSyncStewardQueue(queue, {
                    taskId: options.task,
                    stewardWorkId: options.stewardWorkId,
                    receiptRef: receipt.receiptRef,
                    receiptDigest: receipt.receiptDigest
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
    const frameworkTempHealth = resolveFrameworkTempRunnerSyncTaskHealth(cwd, taskId);
    if (frameworkTempHealth) {
        return frameworkTempHealth;
    }
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
function resolveFrameworkTempRunnerSyncTaskHealth(cwd, taskId) {
    const normalizedTaskId = String(taskId ?? '').trim();
    if (!normalizedTaskId.startsWith('ATM-FRAMEWORK-TEMP-')) {
        return null;
    }
    const lockPath = path.join(cwd, '.atm', 'runtime', 'locks', `${normalizedTaskId}.lock.json`);
    if (!existsSync(lockPath)) {
        return 'task-missing';
    }
    try {
        const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
        const workItemId = typeof lock.workItemId === 'string' ? lock.workItemId.trim() : '';
        const leaseId = typeof lock.leaseId === 'string' ? lock.leaseId.trim() : '';
        const heartbeatAt = typeof lock.heartbeatAt === 'string' ? lock.heartbeatAt : null;
        const released = lock.released === true || String(lock.status ?? '').trim().toLowerCase() === 'released';
        const ttlSeconds = typeof lock.ttlSeconds === 'number' && Number.isFinite(lock.ttlSeconds)
            ? lock.ttlSeconds
            : 0;
        if (workItemId !== normalizedTaskId || !leaseId || !heartbeatAt || ttlSeconds <= 0) {
            return 'task-missing';
        }
        return released ? 'task-terminal' : 'task-active';
    }
    catch {
        return 'task-missing';
    }
}
function resolveFullGitCommitSha(cwd, value) {
    const raw = String(value ?? '').trim();
    try {
        return execFileSync('git', ['rev-parse', '--verify', raw], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
    }
    catch {
        return raw;
    }
}
export function validateRunnerSyncReleaseReceipt(input) {
    const receiptRef = String(input.receiptRef ?? '').trim();
    if (!receiptRef) {
        throw new Error('ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_REQUIRED: release requires --receipt-ref pointing at an atm.runnerSyncReceipt.v1 evidence file.');
    }
    const absoluteReceipt = path.resolve(input.cwd, receiptRef);
    if (!absoluteReceipt.startsWith(path.resolve(input.cwd) + path.sep)) {
        throw new Error('ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_INVALID: receipt reference must stay inside the repository.');
    }
    if (!existsSync(absoluteReceipt)) {
        throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_INVALID: receipt file does not exist: ${receiptRef}.`);
    }
    const raw = readFileSync(absoluteReceipt, 'utf8');
    const digest = `sha256:${createHash('sha256').update(raw).digest('hex')}`;
    const expectedDigest = String(input.receiptDigest ?? '').trim();
    if (expectedDigest && expectedDigest !== digest) {
        throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_DIGEST_MISMATCH: receipt digest ${digest} does not match ${expectedDigest}.`);
    }
    let receipt;
    try {
        receipt = JSON.parse(raw);
    }
    catch {
        throw new Error('ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_INVALID: receipt is not valid JSON.');
    }
    const group = input.queue.groups.find((candidate) => candidate.stewardWorkId === input.stewardWorkId);
    if (!group) {
        throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_NOT_FOUND: steward work ${input.stewardWorkId} is not queued.`);
    }
    const ownerRequest = group.requests.find((request) => request.taskId === input.taskId);
    if (!ownerRequest) {
        throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_OWNER_MISMATCH: task ${input.taskId} is not waiting on ${input.stewardWorkId}.`);
    }
    const receiptSurfaces = normalizeReceiptStringArray(receipt.requestedSurfaces);
    const expectedSurfaces = normalizeReceiptStringArray(group.requestedSurfaces);
    const mismatches = [
        receipt.schemaId === 'atm.runnerSyncReceipt.v1' ? null : 'schemaId',
        receipt.taskId === input.taskId ? null : 'taskId',
        receipt.actorId === ownerRequest.actorId ? null : 'actorId',
        receipt.stewardWorkId === input.stewardWorkId ? null : 'stewardWorkId',
        receipt.sealedSourceSha === group.sealedSourceSha ? null : 'sealedSourceSha',
        arraysEqual(receiptSurfaces, expectedSurfaces) ? null : 'requestedSurfaces'
    ].filter(Boolean);
    if (mismatches.length > 0) {
        throw new Error(`ATM_RUNNER_SYNC_STEWARD_RELEASE_RECEIPT_INVALID: receipt does not match queued runner-sync steward fields: ${mismatches.join(', ')}.`);
    }
    return {
        receiptRef: receiptRef.replace(/\\/g, '/'),
        receiptDigest: digest
    };
}
function normalizeReceiptStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.map((entry) => String(entry ?? '').trim().replace(/\\/g, '/')).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
}
function arraysEqual(left, right) {
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
}
function toRunnerSyncQueueCliError(error) {
    const messageText = error instanceof Error ? error.message : String(error ?? '');
    const match = /^(ATM_[A-Z0-9_]+):\s*(.+)$/.exec(messageText);
    if (match) {
        return new CliError(match[1], match[2], { exitCode: 1 });
    }
    return new CliError('ATM_RUNNER_SYNC_QUEUE_FAILED', messageText || 'Runner-sync steward queue operation failed.', { exitCode: 1 });
}

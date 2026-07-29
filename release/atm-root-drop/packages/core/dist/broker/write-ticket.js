import { createHash } from 'node:crypto';
import { computeWriteScopeDigest, inspectWriteScopePolicy, normalizeWritePathList } from './write-scope-policy.js';
export function acquireWriteTicket(input) {
    const issuedAt = input.now ?? new Date().toISOString();
    const ttlSeconds = Number.isFinite(input.ttlSeconds ?? Number.NaN) && (input.ttlSeconds ?? 0) > 0
        ? Math.floor(input.ttlSeconds ?? 0)
        : 3600;
    const expiresAt = new Date(Date.parse(issuedAt) + ttlSeconds * 1000).toISOString();
    const allowedFiles = normalizeWritePathList(input.files);
    const scopeDigest = computeWriteScopeDigest(allowedFiles);
    const ticketSeed = JSON.stringify({
        taskId: input.taskId,
        actorId: input.actorId,
        laneSessionId: input.laneSessionId ?? null,
        allowedFiles,
        intent: input.intent ?? 'write',
        issuedAt,
        expiresAt
    });
    return {
        schemaId: 'atm.writeTicket.v1',
        ticketId: `wt-${createHash('sha256').update(ticketSeed).digest('hex').slice(0, 16)}`,
        taskId: input.taskId,
        actorId: input.actorId,
        laneSessionId: input.laneSessionId ?? null,
        allowedFiles,
        intent: input.intent ?? 'write',
        operationClass: inferOperationClass(input.intent ?? 'write'),
        scopeDigest,
        issuedAt,
        expiresAt,
        recoveryPolicy: 'scope-amendment-first'
    };
}
export function checkWriteTicket(input) {
    return inspectWriteScopePolicy({
        taskId: input.taskId,
        actorId: input.actorId,
        requestedFiles: input.files,
        allowedFiles: input.ticket?.allowedFiles ?? [],
        operation: input.operation,
        observedPhase: input.observedPhase,
        ticketActorId: input.ticket?.actorId ?? null,
        ticketTaskId: input.ticket?.taskId ?? null,
        claimActorId: input.claimActorId ?? null,
        laneSessionId: input.laneSessionId ?? null,
        ticketLaneSessionId: input.ticket?.laneSessionId ?? null,
        ambientActorId: input.ambientActorId ?? null,
        ticketExpiresAt: input.ticket?.expiresAt ?? null,
        recoveryBypassed: input.recoveryBypassed,
        now: input.now
    });
}
function inferOperationClass(intent) {
    const normalized = intent.trim().toLowerCase();
    if (normalized === 'commit' || normalized === 'close' || normalized === 'push')
        return 'delivery-boundary';
    if (normalized === 'stage')
        return 'index-boundary';
    return 'working-tree-write';
}

import { GOVERNANCE_BACKLOG_PROJECTION } from './global-resource-projection.js';
import { buildRelatedTaskBatchEvidence } from './related-task-batching.js';
const defaultTtlSeconds = 420;
export function emptyGeneratedProjectionSteward(now = new Date().toISOString()) {
    return {
        schemaId: 'atm.generatedProjectionSteward.v1',
        specVersion: '0.1.0',
        updatedAt: now,
        queues: []
    };
}
export function classifyBacklogItemShardProjectionWork(paths) {
    const itemShardPaths = sortedUnique(paths.map(normalizePath).filter(isGovernanceBacklogItemShard));
    return {
        schemaId: 'atm.backlogItemShardProjectionClassification.v1',
        itemShardPaths,
        generatedProjectionKeys: [],
        closeBundleMustIncludeMarkdownProjection: false,
        reason: itemShardPaths.length > 0
            ? 'Backlog item shards are append-only source records; Markdown projection rebuild is deferred to the generated-projection steward.'
            : 'No backlog item shard source records were found.'
    };
}
export function enqueueGeneratedProjectionRebuild(document, request) {
    const normalized = normalizeRequest(request);
    const base = normalizeDocument(document, normalized.createdAt);
    const queues = [...base.queues];
    const queueIndex = queues.findIndex((queue) => queue.projectionKey === normalized.projectionKey);
    const existingQueue = queueIndex >= 0 ? queues[queueIndex] : { projectionKey: normalized.projectionKey, entries: [] };
    const entries = [
        ...existingQueue.entries.filter((entry) => entry.taskId !== normalized.taskId),
        requestEntry(normalized, 1)
    ].sort(compareEntries);
    const nextQueue = materializeQueue({ projectionKey: normalized.projectionKey, entries });
    if (queueIndex >= 0)
        queues[queueIndex] = nextQueue;
    else
        queues.push(nextQueue);
    const nextDocument = materializeDocument({ ...base, updatedAt: normalized.heartbeatAt, queues });
    const materialized = nextDocument.queues.find((queue) => queue.projectionKey === normalized.projectionKey) ?? nextQueue;
    const position = materialized.entries.findIndex((entry) => entry.taskId === normalized.taskId) + 1;
    const ownerTaskId = materialized.entries[0]?.taskId ?? normalized.taskId;
    return {
        schemaId: 'atm.generatedProjectionStewardResult.v1',
        ok: true,
        projectionKey: normalized.projectionKey,
        ownerTaskId,
        queuePosition: position,
        sourceItemPaths: normalized.sourceItemPaths,
        suggestedNextAction: position === 1
            ? `Rebuild generated projection ${normalized.projectionKey} from sealed source item shards, then release the projection steward entry.`
            : `Wait for projection steward owner ${ownerTaskId}; retry ${buildRetryCommand(materialized.entries[position - 1])}.`,
        brokerTicket: buildProjectionBrokerTicket(materialized, normalized.taskId, normalized.heartbeatAt, position),
        queue: nextDocument
    };
}
export function cleanupGeneratedProjectionSteward(document, now = new Date().toISOString()) {
    const base = normalizeDocument(document, now);
    const staleReleases = [];
    const queues = base.queues.flatMap((queue) => {
        const live = queue.entries.filter((entry, index) => {
            const expired = Date.parse(entry.expiresAt) <= Date.parse(now);
            if (expired) {
                staleReleases.push({
                    taskId: entry.taskId,
                    actorId: entry.actorId,
                    projectionKey: entry.projectionKey,
                    queuePosition: index + 1,
                    expiredAt: entry.expiresAt,
                    suggestedRetryCommand: entry.suggestedRetryCommand
                });
            }
            return !expired;
        });
        return live.length === 0 ? [] : [materializeQueue({ ...queue, entries: live })];
    });
    return {
        schemaId: 'atm.generatedProjectionStewardCleanupResult.v1',
        ok: true,
        staleReleases,
        queue: materializeDocument({ ...base, updatedAt: now, queues })
    };
}
export function governanceBacklogProjectionKeyForPath(path) {
    const normalized = normalizePath(path);
    if (normalized === 'docs/governance/atm-bug-and-optimization-backlog.md') {
        return GOVERNANCE_BACKLOG_PROJECTION;
    }
    return null;
}
function normalizeDocument(document, now) {
    if (!document || document.schemaId !== 'atm.generatedProjectionSteward.v1') {
        return emptyGeneratedProjectionSteward(now);
    }
    return materializeDocument({
        schemaId: 'atm.generatedProjectionSteward.v1',
        specVersion: '0.1.0',
        updatedAt: document.updatedAt || now,
        queues: Array.isArray(document.queues) ? document.queues : []
    });
}
function materializeDocument(document) {
    return {
        ...document,
        queues: document.queues
            .filter((queue) => queue.entries.length > 0)
            .map(materializeQueue)
            .sort((left, right) => left.projectionKey.localeCompare(right.projectionKey))
    };
}
function materializeQueue(queue) {
    const entries = [...queue.entries]
        .sort(compareEntries)
        .map((entry, index) => ({
        ...entry,
        queuePosition: index + 1,
        suggestedRetryCommand: buildRetryCommand(entry)
    }));
    return { ...queue, entries };
}
function normalizeRequest(request) {
    const createdAt = validIso(request.createdAt) ? request.createdAt : new Date().toISOString();
    const heartbeatAt = validIso(request.heartbeatAt) ? request.heartbeatAt : createdAt;
    const ttlSeconds = Number.isFinite(request.ttlSeconds) && (request.ttlSeconds ?? 0) > 0
        ? Math.trunc(request.ttlSeconds)
        : defaultTtlSeconds;
    const normalized = {
        taskId: String(request.taskId ?? '').trim(),
        actorId: String(request.actorId ?? '').trim(),
        projectionKey: String(request.projectionKey ?? '').trim(),
        sourceItemPaths: sortedUnique(request.sourceItemPaths.map(normalizePath).filter(Boolean)),
        waveId: normalizeOptional(request.waveId),
        surfaceFamily: normalizeOptional(request.surfaceFamily) ?? `projection:${String(request.projectionKey ?? '').trim()}`,
        validators: sortedUnique((request.validators ?? []).map((validator) => String(validator ?? '').trim()).filter(Boolean)),
        createdAt,
        heartbeatAt,
        ttlSeconds
    };
    if (!normalized.taskId || !normalized.actorId || !normalized.projectionKey || normalized.sourceItemPaths.length === 0) {
        throw new Error('ATM_GENERATED_PROJECTION_STEWARD_REQUEST_INVALID: task, actor, projection key, and source item paths are required.');
    }
    return normalized;
}
function requestEntry(request, queuePosition) {
    const expiresAt = new Date(Date.parse(request.heartbeatAt) + request.ttlSeconds * 1000).toISOString();
    return {
        ...request,
        expiresAt,
        queuePosition,
        suggestedRetryCommand: ''
    };
}
function compareEntries(left, right) {
    const createdOrder = left.createdAt.localeCompare(right.createdAt);
    if (createdOrder !== 0)
        return createdOrder;
    return left.taskId.localeCompare(right.taskId);
}
function buildRetryCommand(entry) {
    const items = entry.sourceItemPaths.map((itemPath) => ` --source-item ${quoteArg(itemPath)}`).join('');
    return `node atm.mjs broker projection enqueue --task ${quoteArg(entry.taskId)} --actor ${quoteArg(entry.actorId)} --projection-key ${quoteArg(entry.projectionKey)}${items} --json`;
}
function buildProjectionBrokerTicket(queue, taskId, now, position) {
    const entry = queue.entries.find((candidate) => candidate.taskId === taskId) ?? queue.entries[0];
    const enqueuedAt = entry?.createdAt ?? now;
    const waitedMs = Math.max(0, Date.parse(now) - Date.parse(enqueuedAt));
    const batch = buildProjectionBatchEvidence(queue, entry);
    return {
        schemaId: 'atm.brokerTicket.v1',
        ticketId: `projection:${queue.projectionKey}:${taskId}`,
        position,
        headOwner: queue.entries[0]?.taskId ?? null,
        headHealth: 'task-active',
        batchEligible: batch !== null,
        waveId: entry?.waveId ?? null,
        surfaceFamily: entry?.surfaceFamily ?? `projection:${queue.projectionKey}`,
        batch,
        enqueuedAt,
        waitedMs: Number.isFinite(waitedMs) ? waitedMs : 0,
        sharedSurface: queue.projectionKey,
        scopeClass: ['code']
    };
}
function buildProjectionBatchEvidence(queue, entry) {
    return buildRelatedTaskBatchEvidence({
        batchId: queue.projectionKey,
        candidate: entry ? { ...entry, ticketId: `projection:${queue.projectionKey}:${entry.taskId}` } : null,
        candidates: queue.entries.map((candidate) => ({
            ...candidate,
            ticketId: `projection:${queue.projectionKey}:${candidate.taskId}`
        }))
    });
}
function isGovernanceBacklogItemShard(path) {
    return path.startsWith('docs/governance/atm-bug-and-optimization-backlog.items/')
        && path.endsWith('.json');
}
function sortedUnique(values) {
    return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
function normalizePath(value) {
    return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
function normalizeOptional(value) {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : null;
}
function validIso(value) {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function quoteArg(value) {
    return JSON.stringify(value);
}

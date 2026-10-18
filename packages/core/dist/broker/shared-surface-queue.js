export function enqueueSharedSurface(input) {
    const entry = normalizeEntry(input.entry);
    const existing = input.queue?.entries ?? [];
    const surfacePath = input.queue?.surfacePath ?? entry?.surfacePath ?? '';
    const queue = {
        schemaId: 'atm.brokerSharedSurfaceQueue.v1',
        surfacePath,
        entries: existing
    };
    if (!entry || surfacePath !== entry.surfacePath) {
        return { ok: false, queue, position: null, code: 'invalid-entry', reason: 'Shared queue entries require one normalized surface path, task, actor, positive epoch, hash, and release condition.' };
    }
    if (existing.some((candidate) => candidate.taskId === entry.taskId)) {
        return { ok: true, queue, position: existing.findIndex((candidate) => candidate.taskId === entry.taskId) + 1, code: 'already-queued', reason: 'Task already has a deterministic shared-surface queue position.' };
    }
    if (existing.some((candidate) => candidate.baseHash !== entry.baseHash)) {
        return { ok: false, queue, position: null, code: 'base-hash-mismatch', reason: 'Shared-surface proposals use different base hashes and require re-arbitration before queueing.' };
    }
    // Every surface uses the same stable request ordering. A task may enter its
    // shared-write lane only after it is head for every requested surface, so it
    // never holds one surface while waiting for another.
    const entries = [...existing, entry].sort(compareQueueEntries);
    return {
        ok: true,
        queue: { ...queue, entries },
        position: entries.length,
        code: 'queued',
        reason: 'Private paths may proceed, but this shared surface remains queued until the prior entry satisfies its release condition.'
    };
}
export function planSharedSurfaceAcquisition(queues, taskId) {
    const relevant = queues
        .filter((queue) => queue.entries.some((entry) => entry.taskId === taskId))
        .sort((left, right) => left.surfacePath.localeCompare(right.surfacePath));
    const waitingOn = relevant
        .filter((queue) => queue.entries[0]?.taskId !== taskId)
        .map((queue) => ({ surfacePath: queue.surfacePath, queueHeadTaskId: queue.entries[0]?.taskId ?? 'unknown' }));
    return {
        taskId,
        orderedSurfacePaths: relevant.map((queue) => queue.surfacePath),
        readyToMutateSharedPaths: relevant.length > 0 && waitingOn.length === 0,
        waitingOn
    };
}
export function releaseSharedSurfaceHead(input) {
    if (input.queue.entries[0]?.taskId !== input.taskId) {
        throw new Error('ATM_BROKER_SHARED_QUEUE_RELEASE_FORBIDDEN: only the queue head may release a shared surface.');
    }
    return { ...input.queue, entries: input.queue.entries.slice(1) };
}
export function applySharedSurfaceQueueTransaction(input) {
    const normalizedEntries = input.entries.map(normalizeEntry);
    if (normalizedEntries.some((entry) => !entry)) {
        const transaction = buildQueueTransaction({
            transactionId: input.transactionId,
            entries: [],
            baseQueues: input.queues,
            nextQueues: input.queues,
            status: 'blocked',
            barrierConflicts: [],
            recoveryHint: 'Invalid queue entry; transaction was not applied.'
        });
        return { ok: false, queues: input.queues, transaction };
    }
    const entries = normalizedEntries;
    let nextQueues = [...input.queues];
    const barrierConflicts = [];
    for (const entry of entries) {
        const current = nextQueues.find((queue) => queue.surfacePath === entry.surfacePath) ?? {
            schemaId: 'atm.brokerSharedSurfaceQueue.v1',
            surfacePath: entry.surfacePath,
            entries: []
        };
        const result = enqueueSharedSurface({ queue: current, entry });
        if (!result.ok) {
            const transaction = buildQueueTransaction({
                transactionId: input.transactionId,
                entries,
                baseQueues: input.queues,
                nextQueues: input.queues,
                status: 'blocked',
                barrierConflicts,
                recoveryHint: result.reason,
                createdAt: input.createdAt
            });
            return { ok: false, queues: input.queues, transaction };
        }
        if (result.queue.entries[0]?.taskId !== entry.taskId) {
            barrierConflicts.push({ surfacePath: entry.surfacePath, queueHeadTaskId: result.queue.entries[0]?.taskId ?? 'unknown' });
        }
        nextQueues = upsertQueue(nextQueues, result.queue);
    }
    const idempotent = digestQueues(input.queues) === digestQueues(nextQueues);
    const transaction = buildQueueTransaction({
        transactionId: input.transactionId,
        entries,
        baseQueues: input.queues,
        nextQueues,
        status: idempotent ? 'idempotent-replay' : 'committed',
        barrierConflicts,
        recoveryHint: barrierConflicts.length > 0
            ? 'Shadow-first Team may continue private work; shared surfaces require barrier release before live write.'
            : null,
        createdAt: input.createdAt
    });
    return { ok: true, queues: nextQueues, transaction };
}
export function diagnoseStaleSharedSurfaceIntents(input) {
    const nowMs = Date.parse(input.now);
    return input.queues.flatMap((queue) => queue.entries.map((entry, index) => {
        const queuedMs = Date.parse(entry.queuedAt);
        const stale = Number.isFinite(nowMs) && Number.isFinite(queuedMs) && nowMs - queuedMs > input.staleAfterMs;
        return {
            taskId: entry.taskId,
            surfacePath: queue.surfacePath,
            queuedAt: entry.queuedAt,
            releaseable: stale && index > 0,
            reason: stale
                ? index === 0
                    ? 'Queue head is stale; require explicit release or re-arbitration before a waiter may advance.'
                    : 'Stale non-head waiter can be released without skipping the active queue head.'
                : 'Intent is not stale.'
        };
    }));
}
// Terminal abandon/recovery must be able to remove a non-head waiter. This is
// deliberately separate from normal head release so an active writer cannot
// skip the deterministic acquisition order by mistake.
export function removeSharedSurfaceEntry(input) {
    return {
        ...input.queue,
        entries: input.queue.entries.filter((entry) => entry.taskId !== input.taskId)
    };
}
function normalizeEntry(value) {
    const taskId = String(value?.taskId ?? '').trim();
    const actorId = String(value?.actorId ?? '').trim();
    const surfacePath = String(value?.surfacePath ?? '').trim().replace(/\\/g, '/');
    const baseHash = String(value?.baseHash ?? '').trim();
    const reason = String(value?.reason ?? '').trim();
    const releaseCondition = String(value?.releaseCondition ?? '').trim();
    if (!taskId || !actorId || !surfacePath || !baseHash || !reason || !releaseCondition || !Number.isInteger(value?.leaseEpoch) || value.leaseEpoch < 1)
        return null;
    return { ...value, taskId, actorId, surfacePath, baseHash, reason, releaseCondition };
}
function compareQueueEntries(left, right) {
    const epochOrder = left.leaseEpoch - right.leaseEpoch;
    if (epochOrder !== 0)
        return epochOrder;
    const queuedAtOrder = left.queuedAt.localeCompare(right.queuedAt);
    if (queuedAtOrder !== 0)
        return queuedAtOrder;
    return left.taskId.localeCompare(right.taskId);
}
function upsertQueue(queues, queue) {
    const next = queues.filter((candidate) => candidate.surfacePath !== queue.surfacePath);
    return [...next, queue].sort((left, right) => left.surfacePath.localeCompare(right.surfacePath));
}
function buildQueueTransaction(input) {
    const first = input.entries[0];
    return {
        schemaId: 'atm.brokerSharedSurfaceQueueTransaction.v1',
        transactionId: input.transactionId,
        taskId: first?.taskId ?? '<invalid>',
        actorId: first?.actorId ?? '<invalid>',
        createdAt: input.createdAt ?? new Date().toISOString(),
        baseQueueDigest: digestQueues(input.baseQueues),
        nextQueueDigest: digestQueues(input.nextQueues),
        intents: input.entries,
        barrierConflicts: input.barrierConflicts,
        status: input.status,
        recoveryHint: input.recoveryHint
    };
}
function digestQueues(queues) {
    const normalized = [...queues]
        .map((queue) => ({ ...queue, entries: [...queue.entries].sort(compareQueueEntries) }))
        .sort((left, right) => left.surfacePath.localeCompare(right.surfacePath));
    let hash = 0;
    const text = JSON.stringify(normalized);
    for (let index = 0; index < text.length; index += 1) {
        hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return `hash32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

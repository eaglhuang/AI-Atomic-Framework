import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createBrokerTicket, transitionBrokerTicket } from './ticket-state.js';
export function createEmptyBrokerTicketStoreDocument(input = {}) {
    const now = input.now ?? new Date().toISOString();
    return {
        schemaId: 'atm.brokerTicketStore.v1',
        specVersion: '0.1.0',
        storeId: input.storeId ?? 'local-ticket-store',
        generation: 0,
        tickets: [],
        transitions: [],
        updatedAt: now
    };
}
export function createBrokerTicketStore(storePath) {
    return {
        storePath,
        read: () => readBrokerTicketStoreSnapshot(storePath),
        commit: (input) => commitBrokerTicketStoreTransaction(storePath, input)
    };
}
export function readBrokerTicketStoreSnapshot(storePath) {
    const document = existsSync(storePath)
        ? parseBrokerTicketStoreDocument(storePath, readFileSync(storePath, 'utf8'))
        : createEmptyBrokerTicketStoreDocument({ now: '1970-01-01T00:00:00.000Z' });
    return {
        schemaId: 'atm.brokerTicketStoreSnapshot.v1',
        storePath,
        generation: document.generation,
        digest: digestBrokerTicketStoreDocument(document),
        document
    };
}
export function digestBrokerTicketStoreDocument(document) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(document))).digest('hex')}`;
}
export function enqueueBrokerTicket(store, input) {
    const base = store.read();
    const idempotencyKey = input.idempotencyKey ?? `enqueue:${input.taskId}:${input.actorId}:${input.resourceKey}`;
    return store.commit({
        base,
        action: 'enqueue',
        taskId: input.taskId,
        actorId: input.actorId,
        laneId: input.laneId ?? null,
        idempotencyKey,
        now: input.now,
        mutate: (document, context) => {
            const ticket = createBrokerTicket({
                taskId: input.taskId,
                actorId: input.actorId,
                resourceKey: input.resourceKey,
                arrivalIndex: document.tickets.length,
                ttlSeconds: input.ttlSeconds,
                now: context.now
            });
            const existing = document.tickets.find((candidate) => candidate.idempotencyKey === ticket.idempotencyKey);
            if (existing)
                return { document, ticket: existing };
            const ready = transitionBrokerTicket({
                ticket,
                to: 'queued',
                actorId: input.actorId,
                reason: 'enqueued in file-backed broker ticket store',
                idempotencyKey,
                now: context.now
            }).ticket;
            return {
                document: { ...document, tickets: [...document.tickets, ready], updatedAt: context.now },
                ticket: ready
            };
        }
    });
}
export function transitionStoredBrokerTicket(store, input) {
    const base = store.read();
    return store.commit({
        base,
        action: 'transition',
        taskId: input.taskId,
        actorId: input.actorId,
        laneId: input.laneId ?? null,
        idempotencyKey: input.idempotencyKey,
        now: input.now,
        mutate: (document, context) => {
            const current = requireTicket(document, input.ticketId);
            const result = transitionBrokerTicket({
                ticket: current,
                to: input.to,
                actorId: input.actorId,
                reason: input.reason,
                idempotencyKey: input.idempotencyKey,
                now: context.now
            });
            return {
                document: replaceTicket(document, result.ticket, context.now),
                ticket: result.ticket
            };
        }
    });
}
export function wakeNextBrokerTicket(store, input) {
    const base = store.read();
    return store.commit({
        base,
        action: 'wake-next',
        taskId: input.taskId,
        actorId: input.actorId,
        laneId: input.laneId ?? null,
        idempotencyKey: input.idempotencyKey,
        now: input.now,
        mutate: (document, context) => {
            const resourceTickets = document.tickets.filter((ticket) => ticket.resourceKey === input.resourceKey);
            const active = resourceTickets.find((ticket) => ticket.state === 'wakeup-pending' || ticket.state === 'executing');
            if (active)
                return { document, ticket: active };
            const candidates = resourceTickets
                .filter((ticket) => ticket.state === 'queued' || ticket.state === 'ready' || ticket.state === 'adoptable')
                .sort(compareTicketPriority(context.now, input.maxBypassCount ?? 2, input.maxEligibleWaitMs ?? 120000));
            const selected = candidates[0] ?? null;
            if (!selected)
                return { document, ticket: null };
            const transitioned = transitionBrokerTicket({
                ticket: selected,
                to: 'wakeup-pending',
                actorId: input.actorId,
                reason: 'single-flight successor wakeup',
                idempotencyKey: input.idempotencyKey,
                now: context.now
            }).ticket;
            const selectedIds = new Set([selected.ticketId]);
            const nextTickets = document.tickets.map((ticket) => {
                if (ticket.ticketId === transitioned.ticketId)
                    return transitioned;
                if (ticket.resourceKey !== input.resourceKey || selectedIds.has(ticket.ticketId))
                    return ticket;
                if (ticket.state !== 'queued' && ticket.state !== 'ready')
                    return ticket;
                return { ...ticket, bypassCount: ticket.bypassCount + 1, updatedAt: context.now };
            });
            return {
                document: { ...document, tickets: nextTickets, updatedAt: context.now },
                ticket: transitioned
            };
        }
    });
}
export function adoptOrphanBrokerTicket(store, input) {
    const base = store.read();
    return store.commit({
        base,
        action: 'adopt-orphan',
        taskId: input.taskId,
        actorId: input.actorId,
        laneId: input.laneId ?? null,
        idempotencyKey: input.idempotencyKey,
        now: input.now,
        mutate: (document, context) => {
            const current = requireTicket(document, input.ticketId);
            if (!isBrokerTicketOrphan(current, context.now)) {
                throw new Error(`ATM_BROKER_TICKET_NOT_ORPHAN: ticket ${current.ticketId} heartbeat has not expired.`);
            }
            const adoptable = transitionBrokerTicket({
                ticket: { ...current, actorId: input.actorId },
                to: current.state === 'adoptable' ? 'ready' : 'adoptable',
                actorId: input.actorId,
                reason: input.reason,
                idempotencyKey: input.idempotencyKey,
                now: context.now
            }).ticket;
            const ready = adoptable.state === 'adoptable'
                ? transitionBrokerTicket({
                    ticket: adoptable,
                    to: 'ready',
                    actorId: input.actorId,
                    reason: 'orphan owner adopted by active lane',
                    idempotencyKey: `${input.idempotencyKey}:ready`,
                    now: context.now
                }).ticket
                : adoptable;
            return {
                document: replaceTicket(document, ready, context.now),
                ticket: ready
            };
        }
    });
}
export function cancelBrokerTicket(store, input) {
    const base = store.read();
    return store.commit({
        base,
        action: 'cancel',
        taskId: input.taskId,
        actorId: input.actorId,
        laneId: input.laneId ?? null,
        idempotencyKey: input.idempotencyKey,
        now: input.now,
        mutate: (document, context) => {
            const current = requireTicket(document, input.ticketId);
            if (current.state === 'executing') {
                throw new Error(`ATM_BROKER_TICKET_CANCEL_REQUIRES_RECONCILE: executing ticket ${current.ticketId} needs side-effect reconcile evidence.`);
            }
            const result = transitionBrokerTicket({
                ticket: current,
                to: 'cancelled',
                actorId: input.actorId,
                reason: input.reason,
                idempotencyKey: input.idempotencyKey,
                now: context.now
            });
            return { document: replaceTicket(document, result.ticket, context.now), ticket: result.ticket };
        }
    });
}
export function reconcileBrokerTicketSideEffect(store, input) {
    const base = store.read();
    return store.commit({
        base,
        action: 'reconcile-side-effect',
        taskId: input.taskId,
        actorId: input.actorId,
        laneId: input.laneId ?? null,
        idempotencyKey: input.idempotencyKey,
        now: input.now,
        mutate: (document, context) => {
            const current = requireTicket(document, input.ticketId);
            const result = transitionBrokerTicket({
                ticket: current,
                to: 'reconcile-required',
                actorId: input.actorId,
                reason: input.reason,
                idempotencyKey: input.idempotencyKey,
                now: context.now
            });
            return { document: replaceTicket(document, result.ticket, context.now), ticket: result.ticket };
        }
    });
}
export function isBrokerTicketOrphan(ticket, now = new Date().toISOString()) {
    const heartbeatMs = Date.parse(ticket.heartbeatAt);
    const nowMs = Date.parse(now);
    if (!Number.isFinite(heartbeatMs) || !Number.isFinite(nowMs))
        return false;
    return heartbeatMs + ticket.ttlSeconds * 1000 <= nowMs;
}
export function commitBrokerTicketStoreTransaction(storePath, input) {
    const current = readBrokerTicketStoreSnapshot(storePath);
    if (current.digest !== input.base.digest || current.generation !== input.base.generation) {
        return buildRevalidationReceipt(storePath, input, current);
    }
    const replay = current.document.transitions.find((transition) => transition.idempotencyKey === input.idempotencyKey);
    if (replay) {
        return {
            schemaId: 'atm.brokerTicketStoreReceipt.v1',
            status: 'idempotent-replay',
            action: input.action,
            taskId: input.taskId,
            actorId: input.actorId,
            laneId: input.laneId ?? null,
            idempotencyKey: input.idempotencyKey,
            storePath,
            baseDigest: current.digest,
            nextDigest: current.digest,
            baseGeneration: current.generation,
            nextGeneration: current.generation,
            transitionEvidence: replay,
            ticket: replay.ticketId ? current.document.tickets.find((ticket) => ticket.ticketId === replay.ticketId) ?? null : null,
            revalidationTicket: null,
            recoveryCommand: null
        };
    }
    const now = input.now ?? new Date().toISOString();
    const mutation = input.mutate(current.document, { now });
    const nextBase = {
        ...mutation.document,
        generation: current.generation + 1,
        updatedAt: now
    };
    const nextDigestWithoutEvidence = digestBrokerTicketStoreDocument(nextBase);
    const evidence = buildTransitionEvidence({
        input,
        storePath,
        ticketId: mutation.ticket?.ticketId ?? null,
        previous: current,
        nextGeneration: nextBase.generation,
        nextDigest: nextDigestWithoutEvidence,
        now
    });
    const next = {
        ...nextBase,
        transitions: [...nextBase.transitions, evidence]
    };
    const nextDigest = digestBrokerTicketStoreDocument(next);
    writeAtomicUtf8(storePath, `${JSON.stringify(next, null, 2)}\n`);
    return {
        schemaId: 'atm.brokerTicketStoreReceipt.v1',
        status: 'committed',
        action: input.action,
        taskId: input.taskId,
        actorId: input.actorId,
        laneId: input.laneId ?? null,
        idempotencyKey: input.idempotencyKey,
        storePath,
        baseDigest: current.digest,
        nextDigest,
        baseGeneration: current.generation,
        nextGeneration: next.generation,
        transitionEvidence: { ...evidence, nextDigest },
        ticket: mutation.ticket ?? null,
        revalidationTicket: null,
        recoveryCommand: null
    };
}
function buildRevalidationReceipt(storePath, input, current) {
    const revalidationTicket = createBrokerTicket({
        taskId: input.taskId,
        actorId: input.actorId,
        resourceKey: `broker-ticket-store:${storePath}:revalidation`,
        now: input.now
    });
    return {
        schemaId: 'atm.brokerTicketStoreReceipt.v1',
        status: 'revalidation-required',
        action: input.action,
        taskId: input.taskId,
        actorId: input.actorId,
        laneId: input.laneId ?? null,
        idempotencyKey: input.idempotencyKey,
        storePath,
        baseDigest: input.base.digest,
        nextDigest: current.digest,
        baseGeneration: input.base.generation,
        nextGeneration: current.generation,
        transitionEvidence: null,
        ticket: null,
        revalidationTicket,
        recoveryCommand: 'Refresh the broker ticket snapshot, revalidate the sealed base, and retry with the same idempotency key.'
    };
}
function buildTransitionEvidence(input) {
    const transitionId = `ticket-store-transition-${stableDigest([
        input.input.action,
        input.input.taskId,
        input.input.actorId,
        input.input.idempotencyKey,
        input.previous.digest
    ].join('\0')).slice(0, 20)}`;
    return {
        schemaId: 'atm.brokerTicketStoreTransitionEvidence.v1',
        transitionId,
        idempotencyKey: input.input.idempotencyKey,
        taskId: input.input.taskId,
        actorId: input.input.actorId,
        laneId: input.input.laneId ?? null,
        ticketId: input.ticketId,
        action: input.input.action,
        previousDigest: input.previous.digest,
        nextDigest: input.nextDigest,
        previousGeneration: input.previous.generation,
        nextGeneration: input.nextGeneration,
        occurredAt: input.now
    };
}
function replaceTicket(document, ticket, now) {
    return {
        ...document,
        tickets: document.tickets.map((candidate) => candidate.ticketId === ticket.ticketId ? ticket : candidate),
        updatedAt: now
    };
}
function requireTicket(document, ticketId) {
    const ticket = document.tickets.find((candidate) => candidate.ticketId === ticketId);
    if (!ticket)
        throw new Error(`ATM_BROKER_TICKET_NOT_FOUND: ${ticketId}`);
    return ticket;
}
function compareTicketPriority(now, maxBypassCount, maxEligibleWaitMs) {
    const nowMs = Date.parse(now);
    return (left, right) => {
        const leftForced = forcedPriority(left, nowMs, maxBypassCount, maxEligibleWaitMs);
        const rightForced = forcedPriority(right, nowMs, maxBypassCount, maxEligibleWaitMs);
        if (leftForced !== rightForced)
            return rightForced - leftForced;
        const arrival = left.arrivalIndex - right.arrivalIndex;
        if (arrival !== 0)
            return arrival;
        const enqueued = left.enqueuedAt.localeCompare(right.enqueuedAt);
        if (enqueued !== 0)
            return enqueued;
        return left.ticketId.localeCompare(right.ticketId);
    };
}
function forcedPriority(ticket, nowMs, maxBypassCount, maxEligibleWaitMs) {
    const enqueuedMs = Date.parse(ticket.enqueuedAt);
    const waitedMs = Number.isFinite(nowMs) && Number.isFinite(enqueuedMs) ? Math.max(0, nowMs - enqueuedMs) : 0;
    return ticket.bypassCount >= maxBypassCount || waitedMs >= maxEligibleWaitMs ? 1 : 0;
}
function parseBrokerTicketStoreDocument(storePath, raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`ATM_BROKER_TICKET_STORE_INVALID_JSON: ${storePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!isBrokerTicketStoreDocument(parsed)) {
        throw new Error(`ATM_BROKER_TICKET_STORE_INVALID_SHAPE: ${storePath}`);
    }
    return parsed;
}
function isBrokerTicketStoreDocument(value) {
    return Boolean(value
        && typeof value === 'object'
        && !Array.isArray(value)
        && value.schemaId === 'atm.brokerTicketStore.v1'
        && value.specVersion === '0.1.0'
        && Array.isArray(value.tickets)
        && Array.isArray(value.transitions)
        && Number.isInteger(value.generation));
}
function stableDigest(value) {
    return createHash('sha256').update(value).digest('hex');
}
function canonicalize(value) {
    if (Array.isArray(value))
        return value.map(canonicalize);
    if (!value || typeof value !== 'object')
        return value;
    return Object.fromEntries(Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]));
}
function writeAtomicUtf8(filePath, content) {
    const dir = dirname(filePath);
    if (!existsSync(dir))
        mkdirSync(dir, { recursive: true });
    const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let fd = null;
    try {
        fd = openSync(tempPath, 'wx');
        writeFileSync(fd, content, 'utf8');
        fsyncSync(fd);
        closeSync(fd);
        fd = null;
        renameSync(tempPath, filePath);
        fsyncDirectory(dir);
    }
    catch (error) {
        if (fd !== null) {
            try {
                closeSync(fd);
            }
            catch {
                // Best effort cleanup after a failed atomic ticket-store write.
            }
        }
        rmSync(tempPath, { force: true });
        throw error;
    }
}
function fsyncDirectory(dir) {
    let fd = null;
    try {
        fd = openSync(dir, 'r');
        fsyncSync(fd);
    }
    catch {
        // Directory fsync is best effort on Windows and some virtual filesystems.
    }
    finally {
        if (fd !== null)
            closeSync(fd);
    }
}

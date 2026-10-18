import { calculateBrokerDecision } from '../decision.js';
import { activeAsIntent, digest, isPendingSerialTicket, ownsExactActiveSerialScope, pendingSerialTickets, SERIAL_QUEUE_POLICY, serialPredecessors, serialScopeDigest, serialScopesConflict } from './policy.js';
export function emptySerialQueue() {
    return { schemaId: 'atm.brokerSerialQueue.v1', nextSequence: 1, nextEventSequence: 1, tickets: [], events: [] };
}
function activeBlockers(intent, doc) {
    return doc.activeIntents.filter((active) => {
        if (active.taskId === intent.taskId)
            return false;
        const decision = calculateBrokerDecision(intent, { ...doc, serialQueue: undefined, activeIntents: [active] });
        return decision.verdict !== 'parallel-safe'
            && !(decision.lane === 'deterministic-composer' && !serialScopesConflict(intent, activeAsIntent(active)));
    })
        .map((active) => active.intentId);
}
function blockerTasks(doc, ids) {
    const wanted = new Set(ids);
    return [...new Set([...doc.activeIntents.filter((active) => wanted.has(active.intentId)).map((active) => active.taskId),
            ...(doc.serialQueue?.tickets ?? []).filter((ticket) => wanted.has(ticket.ticketId)).map((ticket) => ticket.taskId)])].sort();
}
export function observeSerialTicket(doc, ticket, now = Date.now()) {
    const predecessors = serialPredecessors(ticket.intent, doc, now);
    const blockers = [...activeBlockers(ticket.intent, doc), ...predecessors.map((entry) => entry.ticketId)];
    const state = (ticket.state === 'queued' || ticket.state === 'eligible') && ticket.expiresAt <= now ? 'expired' : ticket.state;
    const facts = { ticketId: ticket.ticketId, state, sequence: ticket.sequence,
        position: isPendingSerialTicket(ticket, now) ? predecessors.length + 1 : 0,
        waitMs: Math.max(0, (ticket.grantedAt ?? now) - ticket.enqueuedAt), blockerIntentIds: blockers, expiresAt: ticket.expiresAt,
        reason: ticket.reason ?? 'cold-write-conflict', blockerTaskIds: blockerTasks(doc, blockers) };
    return { ...facts, authorityDigest: digest({ ...facts, scopeDigest: ticket.scopeDigest, generation: doc.currentEpoch }), writeAuthorized: false };
}
function replaceTicket(doc, next, now) {
    const queue = doc.serialQueue ?? emptySerialQueue();
    const previous = queue.tickets.find((ticket) => ticket.ticketId === next.ticketId);
    const transitioned = previous?.state !== next.state;
    const event = { sequence: queue.nextEventSequence, ticketId: next.ticketId, taskId: next.taskId,
        state: next.state, at: now, waitMs: Math.max(0, (next.grantedAt ?? now) - next.enqueuedAt), blockerIntentIds: next.blockerIntentIds,
        reason: next.reason ?? 'cold-write-conflict', blockerTaskIds: blockerTasks(doc, next.blockerIntentIds) };
    const all = [...queue.tickets.filter((ticket) => ticket.ticketId !== next.ticketId), next].sort((a, b) => a.sequence - b.sequence);
    const terminal = all.filter((ticket) => !['queued', 'eligible', 'granted'].includes(ticket.state));
    const keepTerminal = new Set(terminal.slice(-SERIAL_QUEUE_POLICY.historyLimit).map((ticket) => ticket.ticketId));
    return { ...doc, serialQueue: { ...queue,
            nextSequence: Math.max(queue.nextSequence, next.sequence + 1),
            nextEventSequence: queue.nextEventSequence + (transitioned ? 1 : 0),
            tickets: all.filter((ticket) => ['queued', 'eligible', 'granted'].includes(ticket.state) || keepTerminal.has(ticket.ticketId)),
            events: transitioned ? [...queue.events, event].slice(-SERIAL_QUEUE_POLICY.eventLimit) : queue.events } };
}
/** Eligibility is a short revalidation window, never an active writer lease. */
export function refreshSerialQueue(doc, now = Date.now()) {
    if (!doc.serialQueue)
        return doc;
    let next = doc;
    for (const ticket of doc.serialQueue.tickets) {
        const lostGrant = ticket.state === 'granted' && !doc.activeIntents.some((active) => ownsExactActiveSerialScope(ticket.intent, active)
            && (!active.expiresAt || Date.parse(active.expiresAt) > now));
        if (lostGrant || ((ticket.state === 'queued' || ticket.state === 'eligible') && ticket.expiresAt <= now)) {
            next = replaceTicket(next, { ...ticket, state: 'expired', blockerIntentIds: [] }, now);
        }
    }
    for (const ticket of pendingSerialTickets(next, now)) {
        const blockers = [...activeBlockers(ticket.intent, next), ...serialPredecessors(ticket.intent, next, now).map((entry) => entry.ticketId)];
        const state = blockers.length === 0 ? 'eligible' : 'queued';
        if (state === ticket.state && JSON.stringify(blockers) === JSON.stringify(ticket.blockerIntentIds))
            continue;
        next = replaceTicket(next, { ...ticket, state, blockerIntentIds: blockers, blockerTaskIds: blockerTasks(next, blockers),
            eligibleAt: state === 'eligible' ? ticket.eligibleAt ?? now : null,
            expiresAt: state === 'eligible' ? Math.min(ticket.expiresAt, now + SERIAL_QUEUE_POLICY.eligibleLeaseMs) : ticket.expiresAt }, now);
    }
    return next;
}
export function enqueueSerialIntent(doc, intent, ttlSeconds, now = Date.now(), reason = 'cold-write-conflict') {
    const existing = pendingSerialTickets(doc, now).find((ticket) => ticket.taskId === intent.taskId);
    if (existing)
        return refreshSerialQueue(doc, now);
    const queue = doc.serialQueue ?? emptySerialQueue();
    const scopeDigest = serialScopeDigest(intent);
    const sequence = queue.nextSequence;
    const ticket = { ticketId: `serial-${sequence}-${digest({ scopeDigest, baseCommit: intent.baseCommit }).slice(7, 23)}`,
        sequence, taskId: intent.taskId, actorId: intent.actorId, scopeDigest,
        intent: structuredClone(intent), state: 'queued', enqueuedAt: now, eligibleAt: null, grantedAt: null,
        expiresAt: now + Math.max(1, Math.floor(ttlSeconds)) * 1000, blockerIntentIds: activeBlockers(intent, doc), reason,
        blockerTaskIds: blockerTasks(doc, activeBlockers(intent, doc)) };
    return refreshSerialQueue(replaceTicket(doc, ticket, now), now);
}
export function transitionSerialTicket(doc, ticketId, state, now = Date.now()) {
    const ticket = doc.serialQueue?.tickets.find((entry) => entry.ticketId === ticketId);
    if (!ticket)
        return doc;
    return replaceTicket(doc, { ...ticket, state, blockerIntentIds: [], blockerTaskIds: [],
        grantedAt: state === 'granted' ? now : ticket.grantedAt }, now);
}
export function releaseSerialTask(doc, taskId, now = Date.now()) {
    let next = doc;
    for (const ticket of doc.serialQueue?.tickets ?? []) {
        if (ticket.taskId !== taskId || !['queued', 'eligible', 'granted'].includes(ticket.state))
            continue;
        next = transitionSerialTicket(next, ticket.ticketId, ticket.state === 'granted' ? 'released' : 'cancelled', now);
    }
    return refreshSerialQueue(next, now);
}

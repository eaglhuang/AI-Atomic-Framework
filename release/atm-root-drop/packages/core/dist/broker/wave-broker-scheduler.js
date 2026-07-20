import { createHash } from 'node:crypto';
import { createBrokerTicket } from './ticket-state.js';
import { defaultBrokerTicketFairnessPolicy, selectComposeFirstTickets } from './ticket-policy.js';
const nonBatchableStates = new Set(['released', 'failed', 'cancelled']);
const ticketStateTransitions = {
    queued: ['head', 'batched', 'executing', 'failed', 'cancelled'],
    head: ['batched', 'executing', 'released', 'failed', 'cancelled'],
    batched: ['executing', 'released', 'failed', 'cancelled'],
    executing: ['released', 'failed', 'cancelled'],
    released: [],
    failed: ['queued', 'cancelled'],
    cancelled: []
};
function stableDigest(value) {
    return createHash('sha256').update(value).digest('hex');
}
function normalizeToken(value) {
    return value.trim();
}
function uniqueSorted(values) {
    return [...new Set(values.map(normalizeToken).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
export function createEmptyWaveBrokerSchedulerDocument(now = new Date().toISOString()) {
    return { schemaId: 'atm.waveBrokerScheduler.v1', specVersion: '0.1.0', tickets: [], updatedAt: now };
}
export function createWaveBrokerTicket(input) {
    const waveId = normalizeToken(input.waveId);
    const taskId = normalizeToken(input.taskId);
    const surfaceFamily = normalizeToken(input.surfaceFamily);
    const payloadDigest = normalizeToken(input.payloadDigest);
    if (!waveId || !taskId || !surfaceFamily || !payloadDigest) {
        throw new Error('waveId, taskId, surfaceFamily, and payloadDigest are required');
    }
    const idempotencyKey = stableDigest([waveId, taskId, input.surfaceKind, surfaceFamily, payloadDigest].join('\0'));
    const now = input.now ?? new Date().toISOString();
    return {
        schemaId: 'atm.waveBrokerTicket.v1',
        ticketId: `wave-ticket-${idempotencyKey.slice(0, 16)}`,
        idempotencyKey,
        waveId,
        taskId,
        surfaceKind: input.surfaceKind,
        surfaceFamily,
        payloadDigest,
        state: 'queued',
        enqueuedAt: now,
        updatedAt: now
    };
}
export function enqueueWaveBrokerTicket(document, input) {
    const ticket = createWaveBrokerTicket(input);
    const existing = document.tickets.find((candidate) => candidate.idempotencyKey === ticket.idempotencyKey);
    if (existing) {
        return { document, ticket: existing, replayed: true };
    }
    return {
        document: { ...document, tickets: [...document.tickets, ticket], updatedAt: ticket.updatedAt },
        ticket,
        replayed: false
    };
}
export function transitionWaveBrokerTicket(ticket, to, now = new Date().toISOString()) {
    if (ticket.state === to)
        return ticket;
    if (!ticketStateTransitions[ticket.state].includes(to)) {
        throw new Error(`invalid wave broker ticket transition ${ticket.state} -> ${to}`);
    }
    return { ...ticket, state: to, updatedAt: now };
}
export function planWaveBrokerBatch(input) {
    const nowMs = Date.parse(input.now ?? new Date().toISOString());
    const candidates = input.document.tickets.filter((ticket) => {
        if (nonBatchableStates.has(ticket.state))
            return false;
        if (input.waveId && ticket.waveId !== input.waveId)
            return false;
        if (input.surfaceKind && ticket.surfaceKind !== input.surfaceKind)
            return false;
        if (input.surfaceFamily && ticket.surfaceFamily !== input.surfaceFamily)
            return false;
        return true;
    });
    if (candidates.length === 0) {
        return {
            schemaId: 'atm.waveBrokerBatchDecision.v1',
            verdict: 'empty',
            waveId: input.waveId ?? null,
            surfaceKind: input.surfaceKind ?? null,
            surfaceFamily: input.surfaceFamily ?? null,
            ticketIds: [],
            missingTaskIds: uniqueSorted(input.expectedTaskIds ?? []),
            waitedMs: 0,
            selectionTrace: emptySelectionTrace(input.fairnessPolicy),
            reason: 'no eligible tickets'
        };
    }
    const waveIds = uniqueSorted(candidates.map((ticket) => ticket.waveId));
    const surfaceKinds = uniqueSorted(candidates.map((ticket) => ticket.surfaceKind));
    const surfaceFamilies = uniqueSorted(candidates.map((ticket) => ticket.surfaceFamily));
    const selectedWaveId = input.waveId ?? (waveIds.length === 1 ? waveIds[0] : null);
    const selectedSurfaceKind = input.surfaceKind ?? (surfaceKinds.length === 1 ? surfaceKinds[0] : null);
    const selectedSurfaceFamily = input.surfaceFamily ?? (surfaceFamilies.length === 1 ? surfaceFamilies[0] : null);
    if (!selectedWaveId || !selectedSurfaceKind || !selectedSurfaceFamily) {
        return {
            schemaId: 'atm.waveBrokerBatchDecision.v1',
            verdict: 'serial-fallback',
            waveId: selectedWaveId,
            surfaceKind: selectedSurfaceKind,
            surfaceFamily: selectedSurfaceFamily,
            ticketIds: candidates.map((ticket) => ticket.ticketId),
            missingTaskIds: [],
            waitedMs: 0,
            selectionTrace: buildSelectionTrace(candidates, input.now, input.fairnessPolicy),
            reason: 'candidate tickets span multiple waves or incompatible surfaces'
        };
    }
    const selected = candidates.filter((ticket) => (ticket.waveId === selectedWaveId
        && ticket.surfaceKind === selectedSurfaceKind
        && ticket.surfaceFamily === selectedSurfaceFamily));
    const taskIds = uniqueSorted(selected.map((ticket) => ticket.taskId));
    const expectedTaskIds = uniqueSorted(input.expectedTaskIds ?? taskIds);
    const missingTaskIds = expectedTaskIds.filter((taskId) => !taskIds.includes(taskId));
    const oldestMs = Math.min(...selected.map((ticket) => Date.parse(ticket.enqueuedAt)).filter(Number.isFinite));
    const waitedMs = Number.isFinite(oldestMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - oldestMs) : 0;
    const timeoutMs = Math.max(0, input.collectionTimeoutMs ?? 120000);
    if (missingTaskIds.length > 0) {
        return {
            schemaId: 'atm.waveBrokerBatchDecision.v1',
            verdict: waitedMs >= timeoutMs ? 'serial-fallback' : 'waiting',
            waveId: selectedWaveId,
            surfaceKind: selectedSurfaceKind,
            surfaceFamily: selectedSurfaceFamily,
            ticketIds: selected.map((ticket) => ticket.ticketId),
            missingTaskIds,
            waitedMs,
            selectionTrace: buildSelectionTrace(selected, input.now, input.fairnessPolicy),
            reason: waitedMs >= timeoutMs ? 'reseal-or-serial-fallback' : 'waiting for expected wave tickets'
        };
    }
    return {
        schemaId: 'atm.waveBrokerBatchDecision.v1',
        verdict: selected.length >= 2 ? 'batch-ready' : 'serial-fallback',
        waveId: selectedWaveId,
        surfaceKind: selectedSurfaceKind,
        surfaceFamily: selectedSurfaceFamily,
        ticketIds: selected.map((ticket) => ticket.ticketId),
        missingTaskIds: [],
        waitedMs,
        selectionTrace: buildSelectionTrace(selected, input.now, input.fairnessPolicy),
        reason: selected.length >= 2 ? 'same wave and compatible surface tickets ready' : 'single ticket uses serial fallback'
    };
}
function buildSelectionTrace(tickets, now, fairnessPolicy) {
    return selectComposeFirstTickets({
        now,
        policy: fairnessPolicy,
        tickets: tickets.map((ticket, index) => ({
            ...createBrokerTicket({
                taskId: ticket.taskId,
                actorId: ticket.taskId,
                resourceKey: `${ticket.surfaceKind}:${ticket.surfaceFamily}`,
                arrivalIndex: index,
                now: ticket.enqueuedAt
            }),
            ticketId: ticket.ticketId,
            idempotencyKey: ticket.idempotencyKey,
            state: ticket.state === 'released' ? 'released' : ticket.state === 'cancelled' ? 'cancelled' : ticket.state === 'executing' ? 'executing' : 'ready',
            updatedAt: ticket.updatedAt,
            heartbeatAt: ticket.updatedAt
        }))
    });
}
function emptySelectionTrace(policy = defaultBrokerTicketFairnessPolicy) {
    return {
        schemaId: 'atm.brokerTicketSelectionTrace.v1',
        selectedTicketIds: [],
        composeCandidateTicketIds: [],
        queuedTicketIds: [],
        bypassedTicketIds: [],
        waitedMsByTicketId: {},
        fairnessCounters: {
            maxObservedBypassCount: 0,
            maxObservedWaitMs: 0,
            duplicateWakeupCount: 0,
            starvationRiskTicketIds: []
        },
        policy,
        reason: 'No eligible tickets.'
    };
}

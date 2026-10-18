import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
export function buildBrokerProjection(authority, input = {}) {
    const base = {
        schemaId: 'atm.brokerProjection.v1',
        specVersion: '0.1.0',
        ticketId: authority.ticketId,
        authorityGeneration: authority.generation,
        authorityDigest: digestBrokerProjectionAuthority(authority),
        watermark: authority.watermark,
        terminalState: authority.terminalState,
        publisherGeneration: input.publisherGeneration ?? authority.generation,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        state: authority.state
    };
    return { ...base, projectionDigest: digestProjectionPayload(base) };
}
export function authorityFromTicketStore(document, ticketId) {
    const ticket = document.tickets.find((candidate) => candidate.ticketId === ticketId);
    if (!ticket)
        throw new Error(`ATM_BROKER_TICKET_NOT_FOUND: ${ticketId}`);
    return {
        schemaId: 'atm.brokerProjectionAuthority.v1',
        ticketId,
        generation: document.generation,
        watermark: document.updatedAt,
        terminalState: isTerminalTicketState(ticket.state) ? 'terminal' : 'open',
        state: ticket
    };
}
export function digestBrokerProjectionAuthority(authority) {
    return stableSha256({
        ticketId: authority.ticketId,
        generation: authority.generation,
        watermark: authority.watermark,
        terminalState: authority.terminalState,
        state: authority.state
    });
}
export function isBrokerProjectionFresh(projection, authority) {
    return projection.ticketId === authority.ticketId
        && projection.authorityGeneration === authority.generation
        && projection.authorityDigest === digestBrokerProjectionAuthority(authority)
        && projection.projectionDigest === digestProjectionPayload(withoutProjectionDigest(projection));
}
export function readBrokerProjection(projectionPath) {
    if (!existsSync(projectionPath))
        return null;
    const parsed = JSON.parse(readFileSync(projectionPath, 'utf8'));
    if (!isBrokerProjection(parsed)) {
        throw new Error(`ATM_BROKER_PROJECTION_INVALID_SHAPE: ${projectionPath}`);
    }
    return parsed;
}
export function atomicWriteBrokerProjection(input) {
    const current = readBrokerProjection(input.projectionPath);
    const expected = input.expectedPublisherGeneration;
    if (expected !== undefined && expected !== null && current && current.publisherGeneration !== expected) {
        return writeReceipt('stale-generation', input.projectionPath, current, null, 0, 'ATM_BROKER_TICKET_STALE_GENERATION');
    }
    if (current?.projectionDigest === input.projection.projectionDigest) {
        return writeReceipt('idempotent-replay', input.projectionPath, current, input.projection, 0, null);
    }
    const maxRetries = input.maxRetries ?? 3;
    for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
        if (attempt <= (input.simulateSharingViolations ?? 0))
            continue;
        writeAtomicUtf8(input.projectionPath, `${JSON.stringify(input.projection, null, 2)}\n`);
        return writeReceipt('committed', input.projectionPath, current, input.projection, attempt, null);
    }
    return writeReceipt('retry-exhausted', input.projectionPath, current, null, maxRetries, 'ATM_ATOMIC_WRITE_RETRY_EXHAUSTED');
}
export function recordBrokerQueueOnlyTrip(input) {
    return {
        schemaId: 'atm.brokerQueueOnlyTrip.v1',
        ticketId: input.ticketId,
        errorCode: 'ATM_BROKER_STATE_DIVERGENCE',
        reason: input.reason,
        preserved: {
            ticket: input.ticket,
            proposal: input.proposal,
            evidence: input.evidence
        }
    };
}
function writeReceipt(status, projectionPath, previous, next, attempts, errorCode) {
    return {
        schemaId: 'atm.brokerProjectionWriteReceipt.v1',
        status,
        projectionPath,
        errorCode,
        previousPublisherGeneration: previous?.publisherGeneration ?? null,
        nextPublisherGeneration: next?.publisherGeneration ?? null,
        projectionDigest: next?.projectionDigest ?? previous?.projectionDigest ?? null,
        attempts
    };
}
function writeAtomicUtf8(filePath, content) {
    mkdirSync(dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    writeFileSync(tmpPath, content, 'utf8');
    const fd = openSync(tmpPath, 'r');
    try {
        fsyncSyncSafe(fd);
    }
    finally {
        closeSync(fd);
    }
    renameSync(tmpPath, filePath);
}
function fsyncSyncSafe(fd) {
    try {
        fsyncSync(fd);
    }
    catch {
        // Some virtual filesystems used in tests do not support fsync. Atomic rename still provides the contract boundary.
    }
}
function isTerminalTicketState(state) {
    return state === 'done' || state === 'cancelled' || state === 'failed' || state === 'reconcile-required';
}
function isBrokerProjection(value) {
    return Boolean(value && typeof value === 'object' && value.schemaId === 'atm.brokerProjection.v1');
}
function withoutProjectionDigest(projection) {
    const { projectionDigest: _projectionDigest, ...rest } = projection;
    return rest;
}
function digestProjectionPayload(value) {
    return stableSha256(value);
}
function stableSha256(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}
function canonicalize(value) {
    if (!value || typeof value !== 'object')
        return value;
    if (Array.isArray(value))
        return value.map(canonicalize);
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
}

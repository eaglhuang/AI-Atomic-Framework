import { assertBrokerTicketCanExecute } from '../ticket-state.js';
import { createHash } from 'node:crypto';
export function attachBrokerTicketAuthorizationGrants(ticket, grants) {
    const current = coerceAuthorityTicket(ticket);
    const authorityGeneration = current.authorityGeneration + 1;
    const provisionalGrants = grants.map((grant, index) => ({
        ...grant,
        grantId: `grant-${authorityGeneration}-${index + 1}`,
        resourceKeys: normalizeList(grant.resourceKeys),
        operations: normalizeList(grant.operations),
        gates: normalizeList(grant.gates),
        authorityGeneration,
        authorityDigest: ''
    }));
    const provisionalTicket = {
        ...current,
        authorityGeneration,
        authorizationGrants: provisionalGrants
    };
    const authorityDigest = digestBrokerTicketAuthority(provisionalTicket);
    return {
        ...provisionalTicket,
        authorityDigest,
        authorizationGrants: provisionalGrants.map((grant) => ({ ...grant, authorityDigest }))
    };
}
export function authorizeBrokerTicket(ticket, request) {
    try {
        assertBrokerTicketCanExecute(ticket);
    }
    catch {
        return decision(coerceAuthorityTicket(ticket), 'terminal-ticket', null);
    }
    const authorityTicket = coerceAuthorityTicket(ticket);
    if (request.expectedAuthorityGeneration !== undefined
        && request.expectedAuthorityGeneration !== authorityTicket.authorityGeneration) {
        return decision(authorityTicket, 'stale-generation', null);
    }
    if (request.expectedAuthorityDigest !== undefined
        && request.expectedAuthorityDigest !== authorityTicket.authorityDigest) {
        return decision(authorityTicket, 'authority-digest-mismatch', null);
    }
    const resourceKind = normalizeToken(request.resourceKind);
    const resourceKey = normalizeToken(request.resourceKey);
    const operation = normalizeToken(request.operation);
    const gate = normalizeToken(request.gate);
    const dimensionGrants = authorityTicket.authorizationGrants.filter((grant) => grant.resourceKind === resourceKind);
    if (dimensionGrants.length === 0)
        return decision(authorityTicket, 'resource-dimension-mismatch', null);
    const keyGrants = dimensionGrants.filter((grant) => grant.resourceKeys.includes(resourceKey));
    if (keyGrants.length === 0)
        return decision(authorityTicket, 'resource-key-mismatch', null);
    const operationGrants = keyGrants.filter((grant) => grant.operations.includes(operation));
    if (operationGrants.length === 0)
        return decision(authorityTicket, 'operation-mismatch', null);
    const grant = operationGrants.find((candidate) => candidate.gates.includes(gate));
    if (!grant)
        return decision(authorityTicket, 'gate-mismatch', null);
    if (grant.authorityGeneration !== authorityTicket.authorityGeneration
        || grant.authorityDigest !== authorityTicket.authorityDigest) {
        return decision(authorityTicket, 'authority-digest-mismatch', grant.grantId);
    }
    return decision(authorityTicket, 'authorized', grant.grantId);
}
function decision(ticket, statusCode, grantId) {
    return {
        authorized: statusCode === 'authorized',
        statusCode,
        ticketId: ticket.ticketId,
        authorityGeneration: ticket.authorityGeneration,
        authorityDigest: ticket.authorityDigest,
        grantId
    };
}
function normalizeList(values) {
    return [...new Set(values.map(normalizeToken).filter(Boolean))].sort();
}
function normalizeToken(value) {
    return String(value ?? '').trim().replace(/\\/g, '/');
}
function coerceAuthorityTicket(ticket) {
    const record = ticket;
    const authorityGeneration = Number.isInteger(record.authorityGeneration) ? record.authorityGeneration : 0;
    const authorizationGrants = Array.isArray(record.authorizationGrants) ? record.authorizationGrants : [];
    const provisional = {
        ...ticket,
        authorityGeneration,
        authorizationGrants,
        authorityDigest: typeof record.authorityDigest === 'string'
            ? record.authorityDigest
            : 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
    };
    return { ...provisional, authorityDigest: digestBrokerTicketAuthority(provisional) };
}
function digestBrokerTicketAuthority(ticket) {
    return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize({
        ticketId: ticket.ticketId,
        generation: ticket.generation,
        authorityGeneration: ticket.authorityGeneration,
        authorizationGrants: ticket.authorizationGrants.map((grant) => ({
            ...grant,
            authorityDigest: ''
        }))
    }))).digest('hex')}`;
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

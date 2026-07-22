import {
  assertBrokerTicketCanExecute,
  type BrokerTicket
} from '../ticket-state.ts';
import { createHash } from 'node:crypto';

export type BrokerTicketAuthorizationResourceKind = 'path' | 'atom' | 'surface' | 'range';
export type BrokerTicketOperation = 'read' | 'write' | 'commit' | 'close' | 'execute' | (string & {});
export type BrokerTicketGate = 'git' | 'taskflow' | 'broker' | 'runner-sync' | (string & {});

export interface BrokerTicketAuthorizationGrant {
  readonly grantId: string;
  readonly resourceKind: BrokerTicketAuthorizationResourceKind;
  readonly resourceKeys: readonly string[];
  readonly operations: readonly string[];
  readonly gates: readonly string[];
  readonly authorityGeneration: number;
  readonly authorityDigest: string;
}

export type BrokerTicketWithAuthority = BrokerTicket & {
  readonly authorityGeneration: number;
  readonly authorityDigest: string;
  readonly authorizationGrants: readonly BrokerTicketAuthorizationGrant[];
};

export interface BrokerTicketAuthorizationRequest {
  readonly resourceKind: BrokerTicketAuthorizationResourceKind;
  readonly resourceKey: string;
  readonly operation: BrokerTicketOperation;
  readonly gate: BrokerTicketGate;
  readonly expectedAuthorityGeneration?: number;
  readonly expectedAuthorityDigest?: string;
}

export interface BrokerTicketAuthorizationDecision {
  readonly authorized: boolean;
  readonly statusCode:
    | 'authorized'
    | 'terminal-ticket'
    | 'stale-generation'
    | 'authority-digest-mismatch'
    | 'resource-dimension-mismatch'
    | 'resource-key-mismatch'
    | 'operation-mismatch'
    | 'gate-mismatch';
  readonly ticketId: string;
  readonly authorityGeneration: number;
  readonly authorityDigest: string;
  readonly grantId: string | null;
}

export function attachBrokerTicketAuthorizationGrants(
  ticket: BrokerTicket,
  grants: readonly Omit<BrokerTicketAuthorizationGrant, 'grantId' | 'authorityGeneration' | 'authorityDigest'>[]
): BrokerTicketWithAuthority {
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

export function authorizeBrokerTicket(
  ticket: BrokerTicket | BrokerTicketWithAuthority,
  request: BrokerTicketAuthorizationRequest
): BrokerTicketAuthorizationDecision {
  try {
    assertBrokerTicketCanExecute(ticket);
  } catch {
    return decision(coerceAuthorityTicket(ticket), 'terminal-ticket', null);
  }
  const authorityTicket = coerceAuthorityTicket(ticket);
  if (
    request.expectedAuthorityGeneration !== undefined
    && request.expectedAuthorityGeneration !== authorityTicket.authorityGeneration
  ) {
    return decision(authorityTicket, 'stale-generation', null);
  }
  if (
    request.expectedAuthorityDigest !== undefined
    && request.expectedAuthorityDigest !== authorityTicket.authorityDigest
  ) {
    return decision(authorityTicket, 'authority-digest-mismatch', null);
  }
  const resourceKind = normalizeToken(request.resourceKind) as BrokerTicketAuthorizationResourceKind;
  const resourceKey = normalizeToken(request.resourceKey);
  const operation = normalizeToken(request.operation);
  const gate = normalizeToken(request.gate);
  const dimensionGrants = authorityTicket.authorizationGrants.filter((grant) => grant.resourceKind === resourceKind);
  if (dimensionGrants.length === 0) return decision(authorityTicket, 'resource-dimension-mismatch', null);
  const keyGrants = dimensionGrants.filter((grant) => grant.resourceKeys.includes(resourceKey));
  if (keyGrants.length === 0) return decision(authorityTicket, 'resource-key-mismatch', null);
  const operationGrants = keyGrants.filter((grant) => grant.operations.includes(operation));
  if (operationGrants.length === 0) return decision(authorityTicket, 'operation-mismatch', null);
  const grant = operationGrants.find((candidate) => candidate.gates.includes(gate));
  if (!grant) return decision(authorityTicket, 'gate-mismatch', null);
  if (
    grant.authorityGeneration !== authorityTicket.authorityGeneration
    || grant.authorityDigest !== authorityTicket.authorityDigest
  ) {
    return decision(authorityTicket, 'authority-digest-mismatch', grant.grantId);
  }
  return decision(authorityTicket, 'authorized', grant.grantId);
}

function decision(
  ticket: BrokerTicketWithAuthority,
  statusCode: BrokerTicketAuthorizationDecision['statusCode'],
  grantId: string | null
): BrokerTicketAuthorizationDecision {
  return {
    authorized: statusCode === 'authorized',
    statusCode,
    ticketId: ticket.ticketId,
    authorityGeneration: ticket.authorityGeneration,
    authorityDigest: ticket.authorityDigest,
    grantId
  };
}

function normalizeList(values: readonly string[]): readonly string[] {
  return [...new Set(values.map(normalizeToken).filter(Boolean))].sort();
}

function normalizeToken(value: string): string {
  return String(value ?? '').trim().replace(/\\/g, '/');
}

function coerceAuthorityTicket(ticket: BrokerTicket | BrokerTicketWithAuthority): BrokerTicketWithAuthority {
  const record = ticket as BrokerTicketWithAuthority;
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

function digestBrokerTicketAuthority(ticket: Pick<BrokerTicketWithAuthority, 'ticketId' | 'generation' | 'authorityGeneration' | 'authorizationGrants'>): string {
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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  );
}

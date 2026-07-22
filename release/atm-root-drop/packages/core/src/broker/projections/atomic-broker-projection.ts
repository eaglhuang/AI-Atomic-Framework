import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BrokerTicketStoreDocument } from '../ticket-store.ts';

export type BrokerProjectionTerminalState = 'open' | 'terminal' | 'queue-only';
export type BrokerProjectionWriteStatus = 'committed' | 'idempotent-replay' | 'stale-generation' | 'retry-exhausted';

export type BrokerProjectionAuthority = Readonly<{
  schemaId: 'atm.brokerProjectionAuthority.v1';
  ticketId: string;
  generation: number;
  watermark: string;
  terminalState: BrokerProjectionTerminalState;
  state: unknown;
}>;

export type AtmBrokerProjectionV1 = Readonly<{
  schemaId: 'atm.brokerProjection.v1';
  specVersion: '0.1.0';
  ticketId: string;
  authorityGeneration: number;
  authorityDigest: string;
  projectionDigest: string;
  watermark: string;
  terminalState: BrokerProjectionTerminalState;
  publisherGeneration: number;
  generatedAt: string;
  state: unknown;
}>;

export type BrokerProjectionWriteReceipt = Readonly<{
  schemaId: 'atm.brokerProjectionWriteReceipt.v1';
  status: BrokerProjectionWriteStatus;
  projectionPath: string;
  errorCode: 'ATM_BROKER_TICKET_STALE_GENERATION' | 'ATM_ATOMIC_WRITE_RETRY_EXHAUSTED' | null;
  previousPublisherGeneration: number | null;
  nextPublisherGeneration: number | null;
  projectionDigest: string | null;
  attempts: number;
}>;

export type BrokerQueueOnlyTrip = Readonly<{
  schemaId: 'atm.brokerQueueOnlyTrip.v1';
  ticketId: string;
  errorCode: 'ATM_BROKER_STATE_DIVERGENCE';
  reason: string;
  preserved: {
    readonly ticket: unknown;
    readonly proposal: unknown;
    readonly evidence: unknown;
  };
}>;

export function buildBrokerProjection(
  authority: BrokerProjectionAuthority,
  input: { readonly publisherGeneration?: number; readonly generatedAt?: string } = {}
): AtmBrokerProjectionV1 {
  const base = {
    schemaId: 'atm.brokerProjection.v1' as const,
    specVersion: '0.1.0' as const,
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

export function authorityFromTicketStore(document: BrokerTicketStoreDocument, ticketId: string): BrokerProjectionAuthority {
  const ticket = document.tickets.find((candidate) => candidate.ticketId === ticketId);
  if (!ticket) throw new Error(`ATM_BROKER_TICKET_NOT_FOUND: ${ticketId}`);
  return {
    schemaId: 'atm.brokerProjectionAuthority.v1',
    ticketId,
    generation: document.generation,
    watermark: document.updatedAt,
    terminalState: isTerminalTicketState(ticket.state) ? 'terminal' : 'open',
    state: ticket
  };
}

export function digestBrokerProjectionAuthority(authority: BrokerProjectionAuthority): string {
  return stableSha256({
    ticketId: authority.ticketId,
    generation: authority.generation,
    watermark: authority.watermark,
    terminalState: authority.terminalState,
    state: authority.state
  });
}

export function isBrokerProjectionFresh(
  projection: AtmBrokerProjectionV1,
  authority: BrokerProjectionAuthority
): boolean {
  return projection.ticketId === authority.ticketId
    && projection.authorityGeneration === authority.generation
    && projection.authorityDigest === digestBrokerProjectionAuthority(authority)
    && projection.projectionDigest === digestProjectionPayload(withoutProjectionDigest(projection));
}

export function readBrokerProjection(projectionPath: string): AtmBrokerProjectionV1 | null {
  if (!existsSync(projectionPath)) return null;
  const parsed = JSON.parse(readFileSync(projectionPath, 'utf8'));
  if (!isBrokerProjection(parsed)) {
    throw new Error(`ATM_BROKER_PROJECTION_INVALID_SHAPE: ${projectionPath}`);
  }
  return parsed;
}

export function atomicWriteBrokerProjection(input: {
  readonly projectionPath: string;
  readonly projection: AtmBrokerProjectionV1;
  readonly expectedPublisherGeneration?: number | null;
  readonly maxRetries?: number;
  readonly simulateSharingViolations?: number;
}): BrokerProjectionWriteReceipt {
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
    if (attempt <= (input.simulateSharingViolations ?? 0)) continue;
    writeAtomicUtf8(input.projectionPath, `${JSON.stringify(input.projection, null, 2)}\n`);
    return writeReceipt('committed', input.projectionPath, current, input.projection, attempt, null);
  }
  return writeReceipt('retry-exhausted', input.projectionPath, current, null, maxRetries, 'ATM_ATOMIC_WRITE_RETRY_EXHAUSTED');
}

export function recordBrokerQueueOnlyTrip(input: {
  readonly ticketId: string;
  readonly reason: string;
  readonly ticket: unknown;
  readonly proposal: unknown;
  readonly evidence: unknown;
}): BrokerQueueOnlyTrip {
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

function writeReceipt(
  status: BrokerProjectionWriteStatus,
  projectionPath: string,
  previous: AtmBrokerProjectionV1 | null,
  next: AtmBrokerProjectionV1 | null,
  attempts: number,
  errorCode: BrokerProjectionWriteReceipt['errorCode']
): BrokerProjectionWriteReceipt {
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

function writeAtomicUtf8(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, content, 'utf8');
  const fd = openSync(tmpPath, 'r');
  try {
    fsyncSyncSafe(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmpPath, filePath);
}

function fsyncSyncSafe(fd: number): void {
  try {
    fsyncSync(fd);
  } catch {
    // Some virtual filesystems used in tests do not support fsync. Atomic rename still provides the contract boundary.
  }
}

function isTerminalTicketState(state: string): boolean {
  return state === 'done' || state === 'cancelled' || state === 'failed' || state === 'reconcile-required';
}

function isBrokerProjection(value: unknown): value is AtmBrokerProjectionV1 {
  return Boolean(value && typeof value === 'object' && (value as { schemaId?: unknown }).schemaId === 'atm.brokerProjection.v1');
}

function withoutProjectionDigest(projection: AtmBrokerProjectionV1): Omit<AtmBrokerProjectionV1, 'projectionDigest'> {
  const { projectionDigest: _projectionDigest, ...rest } = projection;
  return rest;
}

function digestProjectionPayload(value: Omit<AtmBrokerProjectionV1, 'projectionDigest'>): string {
  return stableSha256(value);
}

function stableSha256(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function canonicalize(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalize(item)]));
}

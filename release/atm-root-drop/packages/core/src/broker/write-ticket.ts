import { createHash } from 'node:crypto';
import {
  computeWriteScopeDigest,
  inspectWriteScopePolicy,
  normalizeWritePathList,
  type WriteScopePolicyDecision,
  type WriteScopeOperation
} from './write-scope-policy.ts';

export interface WriteTicket {
  readonly schemaId: 'atm.writeTicket.v1';
  readonly ticketId: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly laneSessionId: string | null;
  readonly allowedFiles: readonly string[];
  readonly intent: string;
  readonly operationClass: string;
  readonly scopeDigest: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly recoveryPolicy: 'scope-amendment-first';
}

export interface WriteTicketAcquireInput {
  readonly taskId: string;
  readonly actorId: string;
  readonly files: readonly string[];
  readonly intent?: string | null;
  readonly laneSessionId?: string | null;
  readonly ttlSeconds?: number | null;
  readonly now?: string | null;
}

export function acquireWriteTicket(input: WriteTicketAcquireInput): WriteTicket {
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

export function checkWriteTicket(input: {
  readonly ticket: WriteTicket | null;
  readonly taskId: string;
  readonly actorId: string;
  readonly files: readonly string[];
  readonly operation?: WriteScopeOperation;
  readonly observedPhase?: 'pre-write' | 'post-write' | 'commit' | 'close' | 'push';
  readonly claimActorId?: string | null;
  readonly laneSessionId?: string | null;
  readonly ambientActorId?: string | null;
  readonly recoveryBypassed?: boolean;
  readonly now?: string | null;
}): WriteScopePolicyDecision {
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

function inferOperationClass(intent: string): string {
  const normalized = intent.trim().toLowerCase();
  if (normalized === 'commit' || normalized === 'close' || normalized === 'push') return 'delivery-boundary';
  if (normalized === 'stage') return 'index-boundary';
  return 'working-tree-write';
}

export type { WriteScopePolicyDecision };

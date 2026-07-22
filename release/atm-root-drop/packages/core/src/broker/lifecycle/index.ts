import { createHash } from 'node:crypto';
import type { BrokerTicket } from '../ticket-state.ts';

export type BrokerTicketCompletionSideEffectKind = 'publish' | 'release' | 'wakeup';

export interface BrokerTicketCompletionSideEffect {
  readonly kind: BrokerTicketCompletionSideEffectKind;
  readonly target: string;
  readonly idempotencyKey: string;
}

export interface BrokerTicketCompletionReceipt {
  readonly schemaId: 'atm.brokerTicketCompletionReceipt.v1';
  readonly ticketId: string;
  readonly taskId: string;
  readonly ok: boolean;
  readonly code:
    | null
    | 'ATM_BROKER_STATE_DIVERGENCE'
    | 'ATM_TICKET_CANCEL_REQUIRED'
    | 'ATM_SIDE_EFFECT_RECONCILE_REQUIRED';
  readonly previousStateDigest: string;
  readonly nextStateDigest: string;
  readonly generation: number;
  readonly terminalAuthorizationCount: number;
  readonly duplicateSideEffectCount: number;
  readonly queueOnly: boolean;
  readonly sideEffects: readonly BrokerTicketCompletionSideEffect[];
  readonly findings: readonly string[];
}

export interface TaskflowCloseIndexIsolationReceipt {
  readonly schemaId: 'atm.taskflowCloseIndexIsolationReceipt.v1';
  readonly ok: boolean;
  readonly parkedForeignEntries: readonly string[];
  readonly restoredForeignEntries: readonly string[];
  readonly closeScopedEntries: readonly string[];
  readonly beforeDigest: string;
  readonly afterDigest: string;
  readonly restoreContract: 'immutable-receipt-required';
}

export function completeBrokerTicketTransaction(input: {
  readonly ticket: BrokerTicket & {
    readonly authorizationGrants?: readonly unknown[];
    readonly completedSideEffects?: readonly BrokerTicketCompletionSideEffect[];
  };
  readonly actorId: string;
  readonly idempotencyKey: string;
  readonly now?: string;
  readonly successorTaskId?: string | null;
  readonly sideEffects?: readonly Omit<BrokerTicketCompletionSideEffect, 'idempotencyKey'>[];
}): BrokerTicketCompletionReceipt {
  const previousStateDigest = digestBrokerLifecycleState(input.ticket);
  const terminalAuthorizationCount = countTerminalAuthorizations(input.ticket);
  const requested = (input.sideEffects ?? defaultCompletionSideEffects(input.ticket, input.successorTaskId))
    .map((entry) => ({
      ...entry,
      idempotencyKey: buildSideEffectIdempotencyKey({
        ticketId: input.ticket.ticketId,
        transitionId: input.idempotencyKey,
        kind: entry.kind,
        target: entry.target
      })
    }));
  const existingKeys = new Set((input.ticket.completedSideEffects ?? []).map((entry) => entry.idempotencyKey));
  const duplicateSideEffectCount = requested.filter((entry) => existingKeys.has(entry.idempotencyKey)).length;
  const findings: string[] = [];
  if (terminalAuthorizationCount > 0) {
    findings.push('terminal-ticket-still-has-authorizations');
  }
  if (duplicateSideEffectCount > 0) {
    findings.push('duplicate-side-effect-detected');
  }
  if (input.ticket.state === 'released') {
    findings.push('duplicate-completion-replayed');
  }
  if (!['executing', 'ready', 'composing', 'wakeup-pending', 'released'].includes(input.ticket.state)) {
    return receipt({
      ticket: input.ticket,
      ok: false,
      code: 'ATM_BROKER_STATE_DIVERGENCE',
      previousStateDigest,
      nextStateDigest: previousStateDigest,
      terminalAuthorizationCount,
      duplicateSideEffectCount,
      queueOnly: true,
      sideEffects: [],
      findings: [...findings, `invalid-completion-state:${input.ticket.state}`]
    });
  }
  if (terminalAuthorizationCount > 0) {
    return receipt({
      ticket: input.ticket,
      ok: false,
      code: 'ATM_TICKET_CANCEL_REQUIRED',
      previousStateDigest,
      nextStateDigest: previousStateDigest,
      terminalAuthorizationCount,
      duplicateSideEffectCount,
      queueOnly: true,
      sideEffects: [],
      findings
    });
  }
  if (duplicateSideEffectCount > 0) {
    return receipt({
      ticket: input.ticket,
      ok: false,
      code: 'ATM_SIDE_EFFECT_RECONCILE_REQUIRED',
      previousStateDigest,
      nextStateDigest: previousStateDigest,
      terminalAuthorizationCount,
      duplicateSideEffectCount,
      queueOnly: true,
      sideEffects: [],
      findings
    });
  }
  const nextState = {
    ...input.ticket,
    state: 'released',
    generation: input.ticket.state === 'released' ? input.ticket.generation : input.ticket.generation + 1,
    updatedAt: input.now ?? input.ticket.updatedAt,
    terminalReason: 'released',
    completedSideEffects: [...(input.ticket.completedSideEffects ?? []), ...requested]
  };
  return receipt({
    ticket: nextState,
    ok: true,
    code: null,
    previousStateDigest,
    nextStateDigest: digestBrokerLifecycleState(nextState),
    terminalAuthorizationCount,
    duplicateSideEffectCount,
    queueOnly: false,
    sideEffects: requested,
    findings
  });
}

export function buildTaskflowCloseIndexIsolationReceipt(input: {
  readonly closeScopedEntries: readonly string[];
  readonly foreignStagedEntries: readonly string[];
  readonly restoredForeignEntries?: readonly string[];
}): TaskflowCloseIndexIsolationReceipt {
  const closeScopedEntries = normalizeList(input.closeScopedEntries);
  const parkedForeignEntries = normalizeList(input.foreignStagedEntries);
  const restoredForeignEntries = normalizeList(input.restoredForeignEntries ?? input.foreignStagedEntries);
  return {
    schemaId: 'atm.taskflowCloseIndexIsolationReceipt.v1',
    ok: JSON.stringify(parkedForeignEntries) === JSON.stringify(restoredForeignEntries),
    parkedForeignEntries,
    restoredForeignEntries,
    closeScopedEntries,
    beforeDigest: digestBrokerLifecycleState({ closeScopedEntries, parkedForeignEntries }),
    afterDigest: digestBrokerLifecycleState({ closeScopedEntries, restoredForeignEntries }),
    restoreContract: 'immutable-receipt-required'
  };
}

export function digestBrokerLifecycleState(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;
}

function receipt(input: {
  readonly ticket: Pick<BrokerTicket, 'ticketId' | 'taskId' | 'generation'>;
  readonly ok: boolean;
  readonly code: BrokerTicketCompletionReceipt['code'];
  readonly previousStateDigest: string;
  readonly nextStateDigest: string;
  readonly terminalAuthorizationCount: number;
  readonly duplicateSideEffectCount: number;
  readonly queueOnly: boolean;
  readonly sideEffects: readonly BrokerTicketCompletionSideEffect[];
  readonly findings: readonly string[];
}): BrokerTicketCompletionReceipt {
  return {
    schemaId: 'atm.brokerTicketCompletionReceipt.v1',
    ticketId: input.ticket.ticketId,
    taskId: input.ticket.taskId,
    ok: input.ok,
    code: input.code,
    previousStateDigest: input.previousStateDigest,
    nextStateDigest: input.nextStateDigest,
    generation: input.ticket.generation,
    terminalAuthorizationCount: input.terminalAuthorizationCount,
    duplicateSideEffectCount: input.duplicateSideEffectCount,
    queueOnly: input.queueOnly,
    sideEffects: input.sideEffects,
    findings: input.findings
  };
}

function countTerminalAuthorizations(ticket: { readonly authorizationGrants?: readonly unknown[] }): number {
  return Array.isArray(ticket.authorizationGrants) ? ticket.authorizationGrants.length : 0;
}

function defaultCompletionSideEffects(ticket: BrokerTicket, successorTaskId?: string | null) {
  return [
    { kind: 'publish' as const, target: ticket.taskId },
    { kind: 'release' as const, target: ticket.resourceKey },
    ...(successorTaskId ? [{ kind: 'wakeup' as const, target: successorTaskId }] : [])
  ];
}

function buildSideEffectIdempotencyKey(input: {
  readonly ticketId: string;
  readonly transitionId: string;
  readonly kind: string;
  readonly target: string;
}): string {
  return ['atm-ticket-side-effect', input.ticketId, input.transitionId, input.kind, input.target].join(':');
}

function normalizeList(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((entry) => entry.trim().replace(/\\/g, '/')).filter(Boolean))].sort();
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

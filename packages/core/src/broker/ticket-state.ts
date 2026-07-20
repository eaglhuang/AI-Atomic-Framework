import { createHash } from 'node:crypto';

export type BrokerTicketState =
  | 'created'
  | 'collecting'
  | 'ready'
  | 'composing'
  | 'revalidation-required'
  | 'queued'
  | 'wakeup-pending'
  | 'executing'
  | 'released'
  | 'cancelled'
  | 'adoptable'
  | 'reconcile-required';

export type BrokerTicketTerminalReason =
  | 'released'
  | 'cancelled'
  | 'adopted'
  | 'reconcile-required'
  | 'policy-terminal';

export interface BrokerTicketTransition {
  readonly eventId: string;
  readonly idempotencyKey: string;
  readonly from: BrokerTicketState;
  readonly to: BrokerTicketState;
  readonly generation: number;
  readonly actorId: string;
  readonly reason: string;
  readonly occurredAt: string;
}

export interface BrokerTicket {
  readonly schemaId: 'atm.brokerTicket.v1';
  readonly specVersion: '0.1.0';
  readonly ticketId: string;
  readonly idempotencyKey: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly resourceKey: string;
  readonly state: BrokerTicketState;
  readonly generation: number;
  readonly arrivalIndex: number;
  readonly enqueuedAt: string;
  readonly updatedAt: string;
  readonly heartbeatAt: string;
  readonly ttlSeconds: number;
  readonly bypassCount: number;
  readonly wakeupCount: number;
  readonly terminalReason: BrokerTicketTerminalReason | null;
  readonly transitions: readonly BrokerTicketTransition[];
}

export interface BrokerTicketTransitionResult {
  readonly ticket: BrokerTicket;
  readonly transition: BrokerTicketTransition;
  readonly replayed: boolean;
}

const allowedTransitions: Readonly<Record<BrokerTicketState, readonly BrokerTicketState[]>> = {
  created: ['collecting', 'ready', 'queued', 'cancelled'],
  collecting: ['ready', 'queued', 'cancelled', 'reconcile-required'],
  ready: ['composing', 'queued', 'executing', 'cancelled', 'revalidation-required'],
  composing: ['executing', 'queued', 'revalidation-required', 'released', 'cancelled'],
  'revalidation-required': ['ready', 'queued', 'reconcile-required', 'cancelled'],
  queued: ['wakeup-pending', 'executing', 'adoptable', 'cancelled', 'reconcile-required'],
  'wakeup-pending': ['ready', 'executing', 'queued', 'cancelled', 'reconcile-required'],
  executing: ['released', 'revalidation-required', 'reconcile-required', 'cancelled'],
  released: [],
  cancelled: [],
  adoptable: ['ready', 'executing', 'cancelled', 'reconcile-required'],
  'reconcile-required': []
};

export function createBrokerTicket(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly resourceKey: string;
  readonly arrivalIndex?: number;
  readonly now?: string;
  readonly ttlSeconds?: number;
}): BrokerTicket {
  const taskId = normalizedToken(input.taskId);
  const actorId = normalizedToken(input.actorId);
  const resourceKey = normalizedToken(input.resourceKey);
  if (!taskId || !actorId || !resourceKey) {
    throw new Error('Broker ticket requires taskId, actorId, and resourceKey.');
  }
  const idempotencyKey = stableDigest([taskId, actorId, resourceKey].join('\0'));
  const now = input.now ?? new Date().toISOString();
  return {
    schemaId: 'atm.brokerTicket.v1',
    specVersion: '0.1.0',
    ticketId: `ticket-${idempotencyKey.slice(0, 16)}`,
    idempotencyKey,
    taskId,
    actorId,
    resourceKey,
    state: 'created',
    generation: 0,
    arrivalIndex: Math.max(0, input.arrivalIndex ?? 0),
    enqueuedAt: now,
    updatedAt: now,
    heartbeatAt: now,
    ttlSeconds: Math.max(1, input.ttlSeconds ?? 1800),
    bypassCount: 0,
    wakeupCount: 0,
    terminalReason: null,
    transitions: []
  };
}

export function transitionBrokerTicket(input: {
  readonly ticket: BrokerTicket;
  readonly to: BrokerTicketState;
  readonly actorId: string;
  readonly reason: string;
  readonly idempotencyKey: string;
  readonly now?: string;
}): BrokerTicketTransitionResult {
  const replay = input.ticket.transitions.find((entry) => entry.idempotencyKey === input.idempotencyKey);
  if (replay) {
    return { ticket: input.ticket, transition: replay, replayed: true };
  }
  if (input.ticket.state === input.to) {
    const transition = buildTransition(input.ticket, input.to, input.actorId, input.reason, input.idempotencyKey, input.now);
    return { ticket: { ...input.ticket, transitions: [...input.ticket.transitions, transition] }, transition, replayed: false };
  }
  if (!allowedTransitions[input.ticket.state].includes(input.to)) {
    throw new Error(`ATM_BROKER_TICKET_TRANSITION_INVALID: ${input.ticket.state} -> ${input.to}`);
  }
  const transition = buildTransition(input.ticket, input.to, input.actorId, input.reason, input.idempotencyKey, input.now);
  return {
    ticket: {
      ...input.ticket,
      state: input.to,
      generation: input.ticket.generation + 1,
      updatedAt: transition.occurredAt,
      heartbeatAt: transition.occurredAt,
      terminalReason: terminalReasonFor(input.to),
      wakeupCount: input.to === 'wakeup-pending' ? input.ticket.wakeupCount + 1 : input.ticket.wakeupCount,
      transitions: [...input.ticket.transitions, transition]
    },
    transition,
    replayed: false
  };
}

export function assertBrokerTicketCanExecute(ticket: BrokerTicket): void {
  if (!['ready', 'composing', 'wakeup-pending', 'adoptable'].includes(ticket.state)) {
    throw new Error(`ATM_BROKER_TICKET_NOT_EXECUTABLE: ticket ${ticket.ticketId} is ${ticket.state}.`);
  }
}

function buildTransition(
  ticket: BrokerTicket,
  to: BrokerTicketState,
  actorId: string,
  reason: string,
  idempotencyKey: string,
  now?: string
): BrokerTicketTransition {
  const occurredAt = now ?? new Date().toISOString();
  return {
    eventId: `ticket-event-${stableDigest([ticket.ticketId, idempotencyKey, to].join('\0')).slice(0, 16)}`,
    idempotencyKey,
    from: ticket.state,
    to,
    generation: ticket.generation + (ticket.state === to ? 0 : 1),
    actorId: normalizedToken(actorId),
    reason: normalizedToken(reason),
    occurredAt
  };
}

function terminalReasonFor(state: BrokerTicketState): BrokerTicketTerminalReason | null {
  if (state === 'released') return 'released';
  if (state === 'cancelled') return 'cancelled';
  if (state === 'reconcile-required') return 'reconcile-required';
  return null;
}

function stableDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizedToken(value: string): string {
  return String(value ?? '').trim().replace(/\\/g, '/');
}

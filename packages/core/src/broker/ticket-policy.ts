import type { BrokerTicket } from './ticket-state.ts';

export interface BrokerTicketFairnessPolicy {
  readonly schemaId: 'atm.brokerTicketFairnessPolicy.v1';
  readonly specVersion: '0.1.0';
  readonly maxBypassCount: number;
  readonly maxEligibleWaitMs: number;
  readonly wakeupCycleBound: number;
  readonly composeBatchMinSize: number;
  readonly seed: string;
  readonly observationHorizonMs: number;
}

export interface BrokerTicketSelectionTrace {
  readonly schemaId: 'atm.brokerTicketSelectionTrace.v1';
  readonly selectedTicketIds: readonly string[];
  readonly composeCandidateTicketIds: readonly string[];
  readonly queuedTicketIds: readonly string[];
  readonly bypassedTicketIds: readonly string[];
  readonly waitedMsByTicketId: Record<string, number>;
  readonly fairnessCounters: {
    readonly maxObservedBypassCount: number;
    readonly maxObservedWaitMs: number;
    readonly duplicateWakeupCount: number;
    readonly starvationRiskTicketIds: readonly string[];
  };
  readonly policy: BrokerTicketFairnessPolicy;
  readonly reason: string;
}

export const defaultBrokerTicketFairnessPolicy: BrokerTicketFairnessPolicy = Object.freeze({
  schemaId: 'atm.brokerTicketFairnessPolicy.v1',
  specVersion: '0.1.0',
  maxBypassCount: 2,
  maxEligibleWaitMs: 120000,
  wakeupCycleBound: 1,
  composeBatchMinSize: 2,
  seed: 'atm.compose-first.v1',
  observationHorizonMs: 300000
});

export function selectComposeFirstTickets(input: {
  readonly tickets: readonly BrokerTicket[];
  readonly now?: string;
  readonly policy?: BrokerTicketFairnessPolicy;
}): BrokerTicketSelectionTrace {
  const policy = input.policy ?? defaultBrokerTicketFairnessPolicy;
  const nowMs = Date.parse(input.now ?? new Date().toISOString());
  const eligible = input.tickets
    .filter((ticket) => ['ready', 'queued', 'wakeup-pending', 'adoptable'].includes(ticket.state))
    .sort(compareTickets);
  const waitedMsByTicketId: Record<string, number> = {};
  for (const ticket of eligible) {
    const enqueuedMs = Date.parse(ticket.enqueuedAt);
    waitedMsByTicketId[ticket.ticketId] = Number.isFinite(nowMs) && Number.isFinite(enqueuedMs)
      ? Math.max(0, nowMs - enqueuedMs)
      : 0;
  }
  const forced = eligible.filter((ticket) =>
    ticket.bypassCount >= policy.maxBypassCount
    || (waitedMsByTicketId[ticket.ticketId] ?? 0) >= policy.maxEligibleWaitMs);
  const composeCandidates = eligible.filter((ticket) => !forced.includes(ticket));
  const selected = forced.length > 0
    ? [forced[0]]
    : composeCandidates.slice(0, Math.max(1, policy.composeBatchMinSize));
  const selectedIds = selected.map((ticket) => ticket.ticketId);
  const queued = eligible.filter((ticket) => !selectedIds.includes(ticket.ticketId));
  const duplicateWakeupCount = eligible.filter((ticket) => ticket.wakeupCount > policy.wakeupCycleBound).length;
  const starvationRiskTicketIds = eligible
    .filter((ticket) => (waitedMsByTicketId[ticket.ticketId] ?? 0) > policy.observationHorizonMs)
    .map((ticket) => ticket.ticketId);
  return {
    schemaId: 'atm.brokerTicketSelectionTrace.v1',
    selectedTicketIds: selectedIds,
    composeCandidateTicketIds: composeCandidates.map((ticket) => ticket.ticketId),
    queuedTicketIds: queued.map((ticket) => ticket.ticketId),
    bypassedTicketIds: queued.filter((ticket) => ticket.bypassCount > 0).map((ticket) => ticket.ticketId),
    waitedMsByTicketId,
    fairnessCounters: {
      maxObservedBypassCount: Math.max(0, ...eligible.map((ticket) => ticket.bypassCount)),
      maxObservedWaitMs: Math.max(0, ...Object.values(waitedMsByTicketId)),
      duplicateWakeupCount,
      starvationRiskTicketIds
    },
    policy,
    reason: forced.length > 0
      ? 'Fairness bound forces the oldest/bypassed eligible ticket before compose batching.'
      : selected.length >= policy.composeBatchMinSize
        ? 'Compose-first policy selected compatible eligible tickets for batch strategy.'
        : 'Single eligible ticket falls back to serial execution.'
  };
}

function compareTickets(left: BrokerTicket, right: BrokerTicket): number {
  const arrivalOrder = left.arrivalIndex - right.arrivalIndex;
  if (arrivalOrder !== 0) return arrivalOrder;
  const timeOrder = left.enqueuedAt.localeCompare(right.enqueuedAt);
  if (timeOrder !== 0) return timeOrder;
  return left.ticketId.localeCompare(right.ticketId);
}

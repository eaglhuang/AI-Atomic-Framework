import assert from 'node:assert/strict';
import { createBrokerTicket, transitionBrokerTicket, type BrokerTicket } from '../../packages/core/src/broker/ticket-state.ts';
import { selectComposeFirstTickets } from '../../packages/core/src/broker/ticket-policy.ts';

const policy = {
  schemaId: 'atm.brokerTicketFairnessPolicy.v1' as const,
  specVersion: '0.1.0' as const,
  maxBypassCount: 2,
  maxEligibleWaitMs: 60000,
  wakeupCycleBound: 1,
  composeBatchMinSize: 4,
  seed: 'scale-fixture-128',
  observationHorizonMs: 180000
};

const tickets: BrokerTicket[] = [];
for (let index = 0; index < 128; index += 1) {
  const created = createBrokerTicket({
    taskId: `ATM-SCALE-${String(index).padStart(3, '0')}`,
    actorId: `captain-${index}`,
    resourceKey: index % 4 === 0 ? 'shared:hot' : `shared:family-${index % 8}`,
    arrivalIndex: index,
    now: new Date(Date.parse('2026-07-20T00:00:00.000Z') + index * 100).toISOString()
  });
  const queued = transitionBrokerTicket({
    ticket: created,
    to: index % 5 === 0 ? 'queued' : 'ready',
    actorId: `captain-${index}`,
    reason: 'scale fixture eligible',
    idempotencyKey: `eligible-${index}`,
    now: new Date(Date.parse(created.enqueuedAt) + 10).toISOString()
  }).ticket;
  const ready = index % 5 === 0
    ? transitionBrokerTicket({
      ticket: queued,
      to: 'wakeup-pending',
      actorId: `captain-${index}`,
      reason: 'queue head released',
      idempotencyKey: `wakeup-${index}`,
      now: new Date(Date.parse(created.enqueuedAt) + 20).toISOString()
    }).ticket
    : queued;
  tickets.push({
    ...ready,
    bypassCount: index === 127 ? 2 : index % 3,
    wakeupCount: index % 5 === 0 ? 1 : 0
  });
}

const trace = selectComposeFirstTickets({
  tickets,
  policy,
  now: '2026-07-20T00:03:00.000Z'
});

assert.equal(trace.schemaId, 'atm.brokerTicketSelectionTrace.v1');
assert.equal(trace.selectedTicketIds.length, 1, 'fairness-forced oldest/bypassed ticket executes before another compose batch');
assert.equal(trace.fairnessCounters.duplicateWakeupCount, 0, 'bounded wakeup cycle prevents duplicate wakeup accounting');
assert.equal(trace.fairnessCounters.starvationRiskTicketIds.length, 0, 'fixture stays within observation horizon');
assert.ok(trace.fairnessCounters.maxObservedWaitMs <= policy.observationHorizonMs);
assert.ok(Object.keys(trace.waitedMsByTicketId).length >= 100, 'scale fixture records per-ticket wait observations');
assert.ok(trace.queuedTicketIds.length > 100, 'non-selected eligible tickets remain queued with durable ids');

console.log('[broker-ticket-fairness-scale.test] ok');

import assert from 'node:assert/strict';
import { createBrokerTicket, transitionBrokerTicket, assertBrokerTicketCanExecute } from '../../packages/core/src/broker/ticket-state.ts';
import { selectComposeFirstTickets } from '../../packages/core/src/broker/ticket-policy.ts';
import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket,
  planWaveBrokerBatch
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';

const created = createBrokerTicket({
  taskId: 'ATM-GOV-0211-A',
  actorId: 'captain-a',
  resourceKey: 'packages/core/src/broker/shared.ts',
  arrivalIndex: 1,
  now: '2026-07-20T00:00:00.000Z'
});
assert.equal(created.state, 'created');
assert.equal(created.generation, 0);

const ready = transitionBrokerTicket({
  ticket: created,
  to: 'ready',
  actorId: 'captain-a',
  reason: 'proposal collected',
  idempotencyKey: 'ready-once',
  now: '2026-07-20T00:00:01.000Z'
});
assert.equal(ready.ticket.state, 'ready');
assert.equal(ready.ticket.generation, 1);
const replay = transitionBrokerTicket({
  ticket: ready.ticket,
  to: 'ready',
  actorId: 'captain-a',
  reason: 'proposal collected',
  idempotencyKey: 'ready-once',
  now: '2026-07-20T00:00:02.000Z'
});
assert.equal(replay.replayed, true, 'transition idempotency key must replay without generation drift');
assert.equal(replay.ticket.generation, 1);

const composing = transitionBrokerTicket({
  ticket: ready.ticket,
  to: 'composing',
  actorId: 'scheduler',
  reason: 'compose-first batch selected',
  idempotencyKey: 'compose-once',
  now: '2026-07-20T00:00:03.000Z'
});
assertBrokerTicketCanExecute(composing.ticket);
const released = transitionBrokerTicket({
  ticket: transitionBrokerTicket({
    ticket: composing.ticket,
    to: 'executing',
    actorId: 'scheduler',
    reason: 'execute selected ticket',
    idempotencyKey: 'execute-once',
    now: '2026-07-20T00:00:04.000Z'
  }).ticket,
  to: 'released',
  actorId: 'scheduler',
  reason: 'shared surface released',
  idempotencyKey: 'release-once',
  now: '2026-07-20T00:00:05.000Z'
});
assert.equal(released.ticket.terminalReason, 'released');
assert.throws(
  () => transitionBrokerTicket({
    ticket: released.ticket,
    to: 'executing',
    actorId: 'scheduler',
    reason: 'illegal terminal reopen',
    idempotencyKey: 'bad-reopen'
  }),
  /ATM_BROKER_TICKET_TRANSITION_INVALID/
);

const ticketB = transitionBrokerTicket({
  ticket: createBrokerTicket({
    taskId: 'ATM-GOV-0211-B',
    actorId: 'captain-b',
    resourceKey: 'packages/core/src/broker/shared.ts',
    arrivalIndex: 2,
    now: '2026-07-20T00:00:10.000Z'
  }),
  to: 'ready',
  actorId: 'captain-b',
  reason: 'proposal collected',
  idempotencyKey: 'ready-b',
  now: '2026-07-20T00:00:11.000Z'
}).ticket;
const selection = selectComposeFirstTickets({
  tickets: [ready.ticket, ticketB],
  now: '2026-07-20T00:00:12.000Z'
});
assert.deepEqual(selection.selectedTicketIds, [ready.ticket.ticketId, ticketB.ticketId], 'compose-first selects compatible ready tickets together');
assert.equal(selection.fairnessCounters.duplicateWakeupCount, 0);

let document = createEmptyWaveBrokerSchedulerDocument('2026-07-20T00:00:00.000Z');
document = enqueueWaveBrokerTicket(document, {
  waveId: 'wave-compose',
  taskId: 'ATM-GOV-0211-A',
  surfaceKind: 'commit',
  surfaceFamily: 'broker-ticket-scheduler',
  payloadDigest: 'sha256:a',
  now: '2026-07-20T00:00:00.000Z'
}).document;
document = enqueueWaveBrokerTicket(document, {
  waveId: 'wave-compose',
  taskId: 'ATM-GOV-0211-B',
  surfaceKind: 'commit',
  surfaceFamily: 'broker-ticket-scheduler',
  payloadDigest: 'sha256:b',
  now: '2026-07-20T00:00:01.000Z'
}).document;
const batch = planWaveBrokerBatch({
  document,
  waveId: 'wave-compose',
  surfaceKind: 'commit',
  surfaceFamily: 'broker-ticket-scheduler',
  expectedTaskIds: ['ATM-GOV-0211-A', 'ATM-GOV-0211-B'],
  now: '2026-07-20T00:00:02.000Z'
});
assert.equal(batch.verdict, 'batch-ready');
assert.equal(batch.selectionTrace?.schemaId, 'atm.brokerTicketSelectionTrace.v1');
assert.equal(batch.selectionTrace?.selectedTicketIds.length, 2);

console.log('[compose-first-ticket-state-machine.test] ok');

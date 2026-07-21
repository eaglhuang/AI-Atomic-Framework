import assert from 'node:assert/strict';
import { completeBrokerTicketTransaction } from '../../packages/core/src/broker/lifecycle/index.ts';
import { createBrokerTicket, transitionBrokerTicket } from '../../packages/core/src/broker/ticket-state.ts';

const ready = transitionBrokerTicket({
  ticket: createBrokerTicket({ taskId: 'ATM-GOV-0233', actorId: 'captain', resourceKey: 'close-window' }),
  to: 'ready',
  actorId: 'captain',
  reason: 'ready',
  idempotencyKey: 'ready'
}).ticket;
const executing = transitionBrokerTicket({
  ticket: ready,
  to: 'executing',
  actorId: 'captain',
  reason: 'execute',
  idempotencyKey: 'execute'
}).ticket;
const first = completeBrokerTicketTransaction({
  ticket: executing,
  actorId: 'captain',
  idempotencyKey: 'close-result',
  sideEffects: [{ kind: 'publish', target: 'ATM-GOV-0233' }]
});
const second = completeBrokerTicketTransaction({
  ticket: { ...executing, completedSideEffects: first.sideEffects },
  actorId: 'captain',
  idempotencyKey: 'close-result',
  sideEffects: [{ kind: 'publish', target: 'ATM-GOV-0233' }]
});

assert.equal(first.ok, true);
assert.equal(first.sideEffects.length, 1);
assert.equal(second.ok, false);
assert.equal(second.code, 'ATM_SIDE_EFFECT_RECONCILE_REQUIRED');
assert.equal(second.sideEffects.length, 0);

console.log('[taskflow-close-exactly-once-result.test] ok');

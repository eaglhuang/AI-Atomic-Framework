import assert from 'node:assert/strict';
import { completeBrokerTicketTransaction } from '../../packages/core/src/broker/lifecycle/index.ts';
import { createBrokerTicket, transitionBrokerTicket } from '../../packages/core/src/broker/ticket-state.ts';

const ready = transitionBrokerTicket({
  ticket: createBrokerTicket({ taskId: 'ATM-GOV-0233', actorId: 'captain', resourceKey: 'shared.ts' }),
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
  idempotencyKey: 'complete',
  successorTaskId: 'ATM-GOV-0234'
});
assert.equal(first.sideEffects.filter((entry) => entry.kind === 'wakeup').length, 1);

const duplicate = completeBrokerTicketTransaction({
  ticket: { ...executing, completedSideEffects: first.sideEffects },
  actorId: 'captain',
  idempotencyKey: 'complete',
  successorTaskId: 'ATM-GOV-0234'
});

assert.equal(duplicate.ok, false);
assert.equal(duplicate.code, 'ATM_SIDE_EFFECT_RECONCILE_REQUIRED');
assert.equal(duplicate.queueOnly, true);
assert.equal(duplicate.duplicateSideEffectCount, 3);

console.log('[single-successor-wakeup.test] ok');

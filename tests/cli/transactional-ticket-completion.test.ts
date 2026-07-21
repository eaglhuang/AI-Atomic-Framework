import assert from 'node:assert/strict';
import { completeBrokerTicketTransaction } from '../../packages/core/src/broker/lifecycle/index.ts';
import { createBrokerTicket, transitionBrokerTicket } from '../../packages/core/src/broker/ticket-state.ts';

const created = createBrokerTicket({ taskId: 'ATM-GOV-0233', actorId: 'captain', resourceKey: 'packages/core/src/broker/lifecycle/index.ts' });
const ready = transitionBrokerTicket({
  ticket: created,
  to: 'ready',
  actorId: 'captain',
  reason: 'ready',
  idempotencyKey: 'ready'
}).ticket;
const executing = transitionBrokerTicket({
  ticket: ready,
  to: 'executing',
  actorId: 'captain',
  reason: 'claimed',
  idempotencyKey: 'execute'
}).ticket;

const receipt = completeBrokerTicketTransaction({
  ticket: executing,
  actorId: 'captain',
  idempotencyKey: 'complete-1',
  successorTaskId: 'ATM-GOV-0234'
});

assert.equal(receipt.ok, true);
assert.equal(receipt.code, null);
assert.equal(receipt.terminalAuthorizationCount, 0);
assert.equal(receipt.duplicateSideEffectCount, 0);
assert.equal(receipt.queueOnly, false);
assert.deepEqual(receipt.sideEffects.map((entry) => entry.kind), ['publish', 'release', 'wakeup']);
assert.notEqual(receipt.previousStateDigest, receipt.nextStateDigest);

console.log('[transactional-ticket-completion.test] ok');

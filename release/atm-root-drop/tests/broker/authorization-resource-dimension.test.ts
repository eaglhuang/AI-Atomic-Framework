import assert from 'node:assert/strict';
import { createBrokerTicket, transitionBrokerTicket } from '../../packages/core/src/broker/ticket-state.ts';
import { attachBrokerTicketAuthorizationGrants, authorizeBrokerTicket } from '../../packages/core/src/broker/ticket-authority/index.ts';

const ready = transitionBrokerTicket({
  ticket: createBrokerTicket({ taskId: 'TASK-A', actorId: 'agent-a', resourceKey: 'shared:git' }),
  to: 'ready',
  actorId: 'agent-a',
  reason: 'ready',
  idempotencyKey: 'ready'
}).ticket;
const ticket = attachBrokerTicketAuthorizationGrants(ready, [
  { resourceKind: 'path', resourceKeys: ['packages/core/src/broker/ticket-state.ts'], operations: ['write'], gates: ['git'] },
  { resourceKind: 'atom', resourceKeys: ['atm.broker.ticket-authority'], operations: ['write'], gates: ['broker'] }
]);

assert.equal(authorizeBrokerTicket(ticket, {
  resourceKind: 'atom',
  resourceKey: 'packages/core/src/broker/ticket-state.ts',
  operation: 'write',
  gate: 'broker'
}).statusCode, 'resource-key-mismatch');

assert.equal(authorizeBrokerTicket(ticket, {
  resourceKind: 'surface',
  resourceKey: 'packages/core/src/broker/ticket-state.ts',
  operation: 'write',
  gate: 'git'
}).statusCode, 'resource-dimension-mismatch');

assert.equal(authorizeBrokerTicket(ticket, {
  resourceKind: 'path',
  resourceKey: 'packages/core/src/broker/ticket-state.ts',
  operation: 'write',
  gate: 'git'
}).authorized, true);

console.log('[authorization-resource-dimension.test] ok');

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
const authorized = attachBrokerTicketAuthorizationGrants(ready, [
  { resourceKind: 'path', resourceKeys: ['file.ts'], operations: ['write'], gates: ['git'] }
]);
const released = transitionBrokerTicket({
  ticket: authorized,
  to: 'cancelled',
  actorId: 'agent-a',
  reason: 'terminal fixture',
  idempotencyKey: 'cancel'
}).ticket as typeof authorized;

const decision = authorizeBrokerTicket(released, {
  resourceKind: 'path',
  resourceKey: 'file.ts',
  operation: 'write',
  gate: 'git',
  expectedAuthorityGeneration: released.authorityGeneration,
  expectedAuthorityDigest: released.authorityDigest
});

assert.equal(decision.authorized, false);
assert.equal(decision.statusCode, 'terminal-ticket');

console.log('[terminal-ticket-authorization.test] ok');

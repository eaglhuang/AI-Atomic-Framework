import assert from 'node:assert/strict';
import { createBrokerTicket, transitionBrokerTicket } from '../../packages/core/src/broker/ticket-state.ts';
import { attachBrokerTicketAuthorizationGrants, authorizeBrokerTicket } from '../../packages/core/src/broker/ticket-authority/index.ts';

const created = createBrokerTicket({
  taskId: 'TASK-A',
  actorId: 'agent-a',
  resourceKey: 'shared:git'
});
const ready = transitionBrokerTicket({
  ticket: created,
  to: 'ready',
  actorId: 'agent-a',
  reason: 'ready for shared write',
  idempotencyKey: 'ready'
}).ticket;
const ticket = attachBrokerTicketAuthorizationGrants(ready, [
  {
    resourceKind: 'path',
    resourceKeys: ['packages/core/src/broker/ticket-authority/index.ts'],
    operations: ['write'],
    gates: ['git']
  }
]);

const decision = authorizeBrokerTicket(ticket, {
  resourceKind: 'path',
  resourceKey: 'packages/core/src/broker/ticket-authority/index.ts',
  operation: 'write',
  gate: 'git',
  expectedAuthorityGeneration: ticket.authorityGeneration,
  expectedAuthorityDigest: ticket.authorityDigest
});

assert.equal(decision.authorized, true);
assert.equal(decision.statusCode, 'authorized');
assert.equal(ticket.authorizationGrants[0]!.authorityDigest, ticket.authorityDigest);
assert.equal(ticket.authorizationGrants[0]!.authorityGeneration, ticket.authorityGeneration);

const stale = authorizeBrokerTicket(ticket, {
  resourceKind: 'path',
  resourceKey: 'packages/core/src/broker/ticket-authority/index.ts',
  operation: 'write',
  gate: 'git',
  expectedAuthorityGeneration: ticket.authorityGeneration - 1,
  expectedAuthorityDigest: ticket.authorityDigest
});
assert.equal(stale.authorized, false);
assert.equal(stale.statusCode, 'stale-generation');

console.log('[canonical-arbitration-authority.test] ok');

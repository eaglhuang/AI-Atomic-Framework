import assert from 'node:assert/strict';
import { assertCanonicalBrokerAuthorizationConsumer } from '../../packages/cli/src/commands/broker/migrate/implementation.ts';
import { attachBrokerTicketAuthorizationGrants } from '../../packages/core/src/broker/ticket-authority/index.ts';
import { createBrokerTicket, transitionBrokerTicket } from '../../packages/core/src/broker/ticket-state.ts';

const ready = transitionBrokerTicket({
  ticket: createBrokerTicket({ taskId: 'ATM-GOV-0233', actorId: 'captain', resourceKey: 'shared.ts' }),
  to: 'ready',
  actorId: 'captain',
  reason: 'ready',
  idempotencyKey: 'ready'
}).ticket;
const ticket = attachBrokerTicketAuthorizationGrants(ready, [
  { resourceKind: 'path', resourceKeys: ['shared.ts'], operations: ['write'], gates: ['git'] }
]);

const authorized = assertCanonicalBrokerAuthorizationConsumer({
  brokerTicket: ticket,
  resourceKind: 'path',
  resourceKey: 'shared.ts',
  operation: 'write',
  gate: 'git',
  expectedAuthorityGeneration: ticket.authorityGeneration,
  expectedAuthorityDigest: ticket.authorityDigest
});
assert.equal(authorized.authorized, true);
assert.equal(authorized.code, null);

const mismatch = assertCanonicalBrokerAuthorizationConsumer({
  brokerTicket: ticket,
  resourceKind: 'surface',
  resourceKey: 'shared.ts',
  operation: 'write',
  gate: 'git'
});
assert.equal(mismatch.authorized, false);
assert.equal(mismatch.code, 'ATM_BROKER_AUTHORIZATION_DIMENSION_MISMATCH');

console.log('[broker-authorization-consumer-migration.test] ok');

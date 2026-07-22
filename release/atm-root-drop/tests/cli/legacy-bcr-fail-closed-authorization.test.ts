import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readResolutionAuthorizedForeignTaskIds } from '../../packages/cli/src/commands/broker-conflict-resolution.ts';
import { createBrokerTicket, transitionBrokerTicket } from '../../packages/core/src/broker/ticket-state.ts';
import { attachBrokerTicketAuthorizationGrants } from '../../packages/core/src/broker/ticket-authority/index.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-bcr-auth-'));
const artifactPath = '.atm/runtime/broker-conflict-resolutions/resolution.json';
mkdirSync(path.join(repo, '.atm/runtime/broker-conflict-resolutions'), { recursive: true });

writeFileSync(path.join(repo, artifactPath), JSON.stringify({
  schemaId: 'atm.brokerConflictResolution.v1',
  primaryTaskId: 'TASK-A',
  currentAllowedTaskId: 'TASK-A',
  blockedTaskIds: ['TASK-B'],
  conflictFiles: ['shared.ts']
}, null, 2));
assert.equal(readResolutionAuthorizedForeignTaskIds(repo, artifactPath, 'TASK-A').size, 0, 'legacy task-id-only BCR fails closed');

const ready = transitionBrokerTicket({
  ticket: createBrokerTicket({ taskId: 'TASK-A', actorId: 'agent-a', resourceKey: 'shared:git' }),
  to: 'ready',
  actorId: 'agent-a',
  reason: 'ready',
  idempotencyKey: 'ready'
}).ticket;
const ticket = attachBrokerTicketAuthorizationGrants(ready, [
  { resourceKind: 'path', resourceKeys: ['shared.ts'], operations: ['write'], gates: ['git'] }
]);

writeFileSync(path.join(repo, artifactPath), JSON.stringify({
  schemaId: 'atm.brokerConflictResolution.v1',
  primaryTaskId: 'TASK-A',
  currentAllowedTaskId: 'TASK-A',
  blockedTaskIds: ['TASK-B'],
  conflictFiles: ['shared.ts'],
  brokerTicket: ticket,
  authorityGeneration: ticket.authorityGeneration,
  authorityDigest: ticket.authorityDigest,
  authorizationResourceKind: 'path',
  authorizationOperation: 'write',
  authorizationGate: 'git'
}, null, 2));
assert.deepEqual([...readResolutionAuthorizedForeignTaskIds(repo, artifactPath, 'TASK-A')], ['TASK-B']);

const cancelled = transitionBrokerTicket({
  ticket,
  to: 'cancelled',
  actorId: 'agent-a',
  reason: 'terminal',
  idempotencyKey: 'cancel'
}).ticket as typeof ticket;
writeFileSync(path.join(repo, artifactPath), JSON.stringify({
  schemaId: 'atm.brokerConflictResolution.v1',
  primaryTaskId: 'TASK-A',
  currentAllowedTaskId: 'TASK-A',
  blockedTaskIds: ['TASK-B'],
  conflictFiles: ['shared.ts'],
  brokerTicket: cancelled,
  authorityGeneration: cancelled.authorityGeneration,
  authorityDigest: cancelled.authorityDigest,
  authorizationResourceKind: 'path',
  authorizationOperation: 'write',
  authorizationGate: 'git'
}, null, 2));
assert.equal(readResolutionAuthorizedForeignTaskIds(repo, artifactPath, 'TASK-A').size, 0, 'terminal canonical ticket fails closed');

console.log('[legacy-bcr-fail-closed-authorization.test] ok');

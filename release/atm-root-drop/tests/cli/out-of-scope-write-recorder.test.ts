import assert from 'node:assert/strict';
import { acquireWriteTicket, checkWriteTicket } from '../../packages/core/src/broker/write-ticket.ts';

const ticket = acquireWriteTicket({
  taskId: 'TASK-WRITE-0003',
  actorId: 'actor-a',
  files: ['packages/cli/src/commands/write-ticket.ts'],
  now: '2026-07-24T00:00:00.000Z'
});

const postWrite = checkWriteTicket({
  ticket,
  taskId: 'TASK-WRITE-0003',
  actorId: 'actor-a',
  files: ['packages/core/src/broker/write-ticket.ts'],
  observedPhase: 'post-write',
  now: '2026-07-24T00:01:00.000Z'
});
assert.equal(postWrite.ok, false);
assert.equal(postWrite.code, 'ATM_WRITE_SCOPE_UNATTACHED_WIP');
assert.equal(postWrite.classification, 'unattached-wip');
assert.match(postWrite.recoveryCommands.scopeAmendAndAttach, /tasks scope add/);
assert.match(postWrite.recoveryCommands.nonDeliveryWipCommit, /--wip-commit/);
assert.match(postWrite.recoveryCommands.discardReceipt, /--discard-wip/);

const protectedHistory = checkWriteTicket({
  ticket,
  taskId: 'TASK-WRITE-0003',
  actorId: 'actor-a',
  files: ['.atm/history/tasks/TASK-WRITE-0003.json'],
  observedPhase: 'pre-write',
  now: '2026-07-24T00:01:00.000Z'
});
assert.equal(protectedHistory.code, 'ATM_WRITE_SCOPE_AMENDMENT_REQUIRED');
assert.deepEqual(protectedHistory.protectedHistoryFiles, ['.atm/history/tasks/TASK-WRITE-0003.json']);

const deliveryBoundary = checkWriteTicket({
  ticket,
  taskId: 'TASK-WRITE-0003',
  actorId: 'actor-a',
  files: ['packages/core/src/broker/write-ticket.ts'],
  operation: 'commit',
  observedPhase: 'commit',
  now: '2026-07-24T00:01:00.000Z'
});
assert.equal(deliveryBoundary.code, 'ATM_WRITE_TICKET_SCOPE_VIOLATION');
assert.equal(deliveryBoundary.classification, 'violation');

console.log('[out-of-scope-write-recorder.test] ok');

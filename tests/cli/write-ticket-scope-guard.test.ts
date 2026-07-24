import assert from 'node:assert/strict';
import { acquireWriteTicket, checkWriteTicket } from '../../packages/core/src/broker/write-ticket.ts';

const ticket = acquireWriteTicket({
  taskId: 'TASK-WRITE-0001',
  actorId: 'actor-a',
  files: ['packages/cli/src/**/*.ts'],
  laneSessionId: 'lane-a',
  now: '2026-07-24T00:00:00.000Z',
  ttlSeconds: 3600
});

const allowed = checkWriteTicket({
  ticket,
  taskId: 'TASK-WRITE-0001',
  actorId: 'actor-a',
  files: ['packages/cli/src/commands/write-ticket.ts'],
  laneSessionId: 'lane-a',
  now: '2026-07-24T00:01:00.000Z'
});
assert.equal(allowed.ok, true);
assert.equal(allowed.code, null);
assert.equal(allowed.classification, 'allowed');

const outOfScope = checkWriteTicket({
  ticket,
  taskId: 'TASK-WRITE-0001',
  actorId: 'actor-a',
  files: ['packages/core/src/broker/write-ticket.ts'],
  laneSessionId: 'lane-a',
  now: '2026-07-24T00:01:00.000Z'
});
assert.equal(outOfScope.ok, false);
assert.equal(outOfScope.code, 'ATM_WRITE_SCOPE_AMENDMENT_REQUIRED');
assert.equal(outOfScope.classification, 'amendment-required');
assert.match(outOfScope.recoveryCommand ?? '', /tasks scope add/);

const missing = checkWriteTicket({
  ticket: null,
  taskId: 'TASK-WRITE-0001',
  actorId: 'actor-a',
  files: ['packages/cli/src/commands/write-ticket.ts']
});
assert.equal(missing.code, 'ATM_WRITE_TICKET_MISSING');
assert.match(missing.recoveryCommand ?? '', /write-ticket acquire/);

const staleActor = checkWriteTicket({
  ticket,
  taskId: 'TASK-WRITE-0001',
  actorId: 'actor-b',
  files: ['packages/cli/src/commands/write-ticket.ts'],
  laneSessionId: 'lane-a',
  now: '2026-07-24T00:01:00.000Z'
});
assert.equal(staleActor.code, 'ATM_WRITE_TICKET_STALE');
assert.equal(staleActor.identity.actorMismatch, true);

console.log('[write-ticket-scope-guard.test] ok');

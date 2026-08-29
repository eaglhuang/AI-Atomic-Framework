import assert from 'node:assert/strict';
import { createCommitAuthorityPolicy } from './commit-authority-scopes.ts';

function task(claim: Record<string, unknown> | null, ticket?: Record<string, unknown>) {
  return {
    taskId: 'TASK-A',
    taskDocument: {
      claim,
      ...(ticket ? { workAdmissionTicket: ticket } : {}),
    },
  };
}

const activeClaim = {
  actorId: 'actor-a',
  leaseId: 'lease-a',
  state: 'active',
  files: ['src/owned/**'],
};
const matchingTicket = {
  schemaId: 'atm.workAdmissionTicket.v1',
  taskId: 'TASK-A',
  actorId: 'actor-a',
  claimGeneration: 'lease-a',
  grants: [{ kind: 'file-write', values: ['src/owned/allowed.ts'] }],
};

const active = createCommitAuthorityPolicy(task(activeClaim, matchingTicket));
assert.equal(active.evaluate('src/owned/allowed.ts').code, 'claim-and-ticket-covered');
assert.equal(active.evaluate('src/owned/not-granted.ts').code, 'outside-ticket-grant');
assert.equal(active.evaluate('src/other.ts').code, 'outside-active-claim');

const released = createCommitAuthorityPolicy(task({ ...activeClaim, state: 'released' }));
assert.equal(released.evaluate('src/owned/allowed.ts').code, 'claim-not-active');

const terminalClosebackTicket = {
  ...matchingTicket,
  origin: 'repair-closure',
  claimGeneration: 'repair-closure:2026-08-29T14:33:19.227Z',
};
const terminalCloseback = createCommitAuthorityPolicy(task(
  { ...activeClaim, state: 'released' },
  terminalClosebackTicket,
));
assert.equal(terminalCloseback.evaluate('src/owned/allowed.ts').code, 'claim-and-ticket-covered');
assert.equal(terminalCloseback.evaluate('src/owned/not-granted.ts').code, 'outside-ticket-grant');

const legacy = createCommitAuthorityPolicy(task(null));
assert.equal(legacy.evaluate('src/legacy.ts').code, 'legacy-inspection');
assert.equal(legacy.evaluate('src/legacy.ts').ok, true);

console.log('commit-authority-scopes: policy atom ok');

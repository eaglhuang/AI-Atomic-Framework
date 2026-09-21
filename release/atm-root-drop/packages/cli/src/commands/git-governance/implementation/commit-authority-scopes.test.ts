import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCommitAuthorityPolicy } from './commit-authority-scopes.ts';
import { issueRepairClosureAdmissionTicket } from '../work-admission-check.ts';

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
  actorId: 'closure-steward',
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

const ticketFixture = mkdtempSync(path.join(os.tmpdir(), 'atm-repair-ticket-'));
try {
  const taskDirectory = path.join(ticketFixture, '.atm', 'history', 'tasks');
  const auditDirectory = path.join(ticketFixture, '.atm', 'history', 'protected-override-audit');
  mkdirSync(taskDirectory, { recursive: true });
  mkdirSync(auditDirectory, { recursive: true });
  writeFileSync(path.join(taskDirectory, 'TASK-A.json'), JSON.stringify({ scopePaths: ['src/owned.ts'] }));
  writeFileSync(path.join(auditDirectory, 'own.json'), JSON.stringify({ taskId: 'TASK-A' }));
  writeFileSync(path.join(auditDirectory, 'foreign.json'), JSON.stringify({ taskId: 'TASK-B' }));
  const repairTicket = issueRepairClosureAdmissionTicket({
    cwd: ticketFixture,
    taskId: 'TASK-A',
    actorId: 'closure-steward',
    now: '2026-08-29T00:00:00.000Z',
  });
  const ticketFiles = repairTicket.grants.find((grant) => grant.kind === 'file-write')?.values ?? [];
  assert(ticketFiles.includes('.atm/history/protected-override-audit/own.json'), 'terminal repair ticket must admit its task-owned audit receipt');
  assert(!ticketFiles.includes('.atm/history/protected-override-audit/foreign.json'), 'terminal repair ticket must not admit another task\'s audit receipt');
} finally {
  rmSync(ticketFixture, { recursive: true, force: true });
}

console.log('commit-authority-scopes: policy atom ok');

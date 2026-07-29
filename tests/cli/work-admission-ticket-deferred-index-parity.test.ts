import assert from 'node:assert/strict';
import { issueWorkAdmissionTicket } from '../../packages/core/src/broker/work-admission-ticket.ts';
import { selectTicketValidatedCommitFiles } from '../../packages/cli/src/commands/git-governance.ts';

const ticket = issueWorkAdmissionTicket({
  taskId: 'TASK-GIT-0025',
  actorId: 'fixture-actor',
  claimGeneration: 'claim-fixture',
  allowedFiles: ['packages/core/src/broker/work-admission-ticket.ts', '.atm/history/tasks/TASK-GIT-0025.json'],
  runnerSelection: { runnerKind: 'frozen', runnerRef: 'fixture', selectedAt: '2026-07-29T00:00:00.000Z' },
  now: '2026-07-29T00:00:00.000Z'
});
const staged = [
  'packages/core/src/broker/work-admission-ticket.ts',
  '.atm/history/tasks/TASK-GIT-0025.json',
  'docs/governance/error-code-registry.json'
];
assert.deepEqual(
  selectTicketValidatedCommitFiles(staged, ticket, true),
  ['packages/core/src/broker/work-admission-ticket.ts', '.atm/history/tasks/TASK-GIT-0025.json'],
  'deferred foreign index residue must be excluded before ticket validation'
);
assert.deepEqual(
  selectTicketValidatedCommitFiles(staged, ticket, false),
  staged,
  'without defer, all staged files remain subject to the ticket gate'
);
console.log('[work-admission-ticket-deferred-index-parity.test] ok');

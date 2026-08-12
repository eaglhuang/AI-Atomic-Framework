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
// ATM-GOV-0348 corrected this expectation. It used to require that, without
// `--defer-foreign-staged`, every staged path stayed subject to the ticket
// gate. That is what made a commit whose own bundle was fully in scope fail
// whenever another lane had anything staged, and the only way past the failure
// was the flag that unstages the other lane's paths. Scoping now follows
// transaction state: in-scope staged work means the commit resolves a
// task-scoped bundle, and a sealed candidate index keeps the rest out of it.
assert.deepEqual(
  selectTicketValidatedCommitFiles(staged, ticket, false),
  ['packages/core/src/broker/work-admission-ticket.ts', '.atm/history/tasks/TASK-GIT-0025.json'],
  'in-scope staged work is admitted on its own bundle, with or without the deferral flag'
);

// The safety property the old assertion was reaching for still holds, and this
// is where it actually lives: with nothing in scope staged there is no
// task-scoped bundle, the commit falls back to the whole staged surface, and
// admission must judge that whole surface.
assert.deepEqual(
  selectTicketValidatedCommitFiles(['docs/governance/error-code-registry.json'], ticket, false),
  ['docs/governance/error-code-registry.json'],
  'with nothing in scope staged, every staged path remains subject to the ticket gate'
);
console.log('[work-admission-ticket-deferred-index-parity.test] ok');

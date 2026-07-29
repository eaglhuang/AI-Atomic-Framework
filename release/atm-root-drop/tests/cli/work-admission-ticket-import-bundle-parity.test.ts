import assert from 'node:assert/strict';
import { checkWorkAdmissionTicket } from '../../packages/core/src/broker/work-admission-ticket.ts';
import { issueTaskImportAdmissionTicket } from '../../packages/cli/src/commands/tasks/task-work-admission-import.ts';

const taskId = 'TASK-GIT-0025';
const ledgerPath = `.atm/history/tasks/${taskId}.json`;
const transitionPath = `.atm/history/task-events/${taskId}/2026-07-29T00-00-00-000Z-import-fixture.json`;
const ticket = issueTaskImportAdmissionTicket({
  taskId,
  ledgerPath,
  transitionPath,
  importedAt: '2026-07-29T00:00:00.000Z',
  sourceDigest: 'sha256:fixture'
});

for (const operation of ['write', 'stage'] as const) {
  assert.equal(checkWorkAdmissionTicket({
    ticket,
    taskId,
    actorId: 'atm-import',
    files: [ledgerPath, transitionPath],
    operation,
    now: '2026-07-29T00:01:00.000Z'
  }).ok, true, `${operation} must accept the exact import bundle`);
}

assert.equal(checkWorkAdmissionTicket({
  ticket,
  taskId,
  actorId: 'atm-import',
  files: ['packages/core/src/broker/work-admission-ticket.ts'],
  operation: 'write',
  now: '2026-07-29T00:01:00.000Z'
}).code, 'ATM_WRITE_TICKET_SCOPE_VIOLATION');

for (const operation of ['commit', 'close', 'push'] as const) {
  assert.equal(checkWorkAdmissionTicket({
    ticket,
    taskId,
    actorId: 'atm-import',
    files: [ledgerPath, transitionPath],
    operation,
    now: '2026-07-29T00:01:00.000Z'
  }).code, 'ATM_WORK_ADMISSION_DELIVERY_NOT_AUTHORIZED');
}

console.log('[work-admission-ticket-import-bundle-parity.test] ok');

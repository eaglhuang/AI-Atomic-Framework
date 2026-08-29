import assert from 'node:assert/strict';
import { issueWorkAdmissionTicket } from '../../../../../core/src/broker/work-admission-ticket.ts';
import { hasValidTerminalRepairClosureAdmission } from './support.ts';

const taskId = 'ATM-GOV-terminal-hook';
const taskPath = `.atm/history/tasks/${taskId}.json`;
const ticket = issueWorkAdmissionTicket({
  taskId,
  origin: 'repair-closure',
  actorId: 'closure-steward',
  laneSessionId: null,
  claimGeneration: 'repair-closure:2026-08-09T14:53:00.000Z',
  allowedFiles: [taskPath],
  runnerSelection: { runnerKind: 'frozen', runnerRef: 'repair-closure', selectedAt: '2026-08-09T14:53:00.000Z' },
  now: '2026-08-09T14:53:00.000Z'
});

assert.equal(hasValidTerminalRepairClosureAdmission({
  task: { workAdmissionTicket: ticket }, taskId, actorId: 'closure-steward', stagedFiles: [taskPath], now: '2026-08-09T14:53:01.000Z'
}), true);
assert.equal(hasValidTerminalRepairClosureAdmission({
  task: { workAdmissionTicket: ticket }, taskId, actorId: 'other-actor', stagedFiles: [taskPath], now: '2026-08-09T14:53:01.000Z'
}), false);
assert.equal(hasValidTerminalRepairClosureAdmission({
  task: { workAdmissionTicket: { ...ticket, origin: 'claim' } }, taskId, actorId: 'closure-steward', stagedFiles: [taskPath], now: '2026-08-09T14:53:01.000Z'
}), false);

console.log('pre-commit support: terminal repair-closure admission ok');

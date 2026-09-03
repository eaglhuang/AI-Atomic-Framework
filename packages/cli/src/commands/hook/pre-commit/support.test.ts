import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { issueWorkAdmissionTicket } from '../../../../../core/src/broker/work-admission-ticket.ts';
import { buildIdentitySetRequiredCommand, hasValidTerminalRepairClosureAdmission } from './support.ts';

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

const auditFixture = mkdtempSync(path.join(os.tmpdir(), 'atm-terminal-audit-'));
try {
  assert.equal(
    buildIdentitySetRequiredCommand(auditFixture, 'unregistered-actor'),
    'node atm.mjs identity set --actor "unregistered-actor" --git-name "<git user.name>" --git-email "<git user.email>" --json',
    'hook remediation must preserve an explicit identity choice',
  );
  const auditPath = '.atm/history/protected-override-audit/own.json';
  const foreignAuditPath = '.atm/history/protected-override-audit/foreign.json';
  mkdirSync(path.join(auditFixture, '.atm', 'history', 'protected-override-audit'), { recursive: true });
  writeFileSync(path.join(auditFixture, auditPath), JSON.stringify({ taskId }));
  writeFileSync(path.join(auditFixture, foreignAuditPath), JSON.stringify({ taskId: 'ATM-GOV-foreign' }));
  assert.equal(hasValidTerminalRepairClosureAdmission({
    cwd: auditFixture, task: { workAdmissionTicket: ticket }, taskId, actorId: 'closure-steward', stagedFiles: [taskPath, auditPath], now: '2026-08-09T14:53:01.000Z'
  }), true, 'a terminal ticket may carry its task-owned protected override receipt');
  assert.equal(hasValidTerminalRepairClosureAdmission({
    cwd: auditFixture, task: { workAdmissionTicket: ticket }, taskId, actorId: 'closure-steward', stagedFiles: [taskPath, foreignAuditPath], now: '2026-08-09T14:53:01.000Z'
  }), false, 'a terminal ticket must still reject another task\'s protected override receipt');
} finally {
  rmSync(auditFixture, { recursive: true, force: true });
}

console.log('pre-commit support: terminal repair-closure admission ok');

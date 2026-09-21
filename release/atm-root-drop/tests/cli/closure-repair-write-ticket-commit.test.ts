import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateTaskWorkAdmissionGate, issueRepairClosureAdmissionTicket } from '../../packages/cli/src/commands/git-governance/work-admission-check.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-repair-ticket-'));
try {
  const taskId = 'TASK-REPAIR-0001';
  const taskPath = path.join(root, '.atm', 'history', 'tasks', `${taskId}.json`);
  mkdirSync(path.dirname(taskPath), { recursive: true });
  writeFileSync(taskPath, JSON.stringify({ workItemId: taskId, status: 'done', claim: { state: 'released' }, deliverables: ['src/delivery.ts'] }), 'utf8');
  const ticket = issueRepairClosureAdmissionTicket({ cwd: root, taskId, actorId: 'repair-agent', laneSessionId: 'lane-repair', now: '2026-08-11T00:00:00.000Z' });
  writeFileSync(taskPath, JSON.stringify({ workItemId: taskId, status: 'done', claim: { state: 'released' }, deliverables: ['src/delivery.ts'], workAdmissionTicket: ticket }), 'utf8');
  const result = evaluateTaskWorkAdmissionGate({ cwd: root, taskId, operation: 'commit', files: ['src/delivery.ts'], producingAtmCommand: 'node atm.mjs git commit', now: '2026-08-11T00:01:00.000Z' });
  assert.equal(ticket.origin, 'repair-closure');
  assert.equal(result.decision.ok, true, 'terminal repair ticket must authorize its returned governed commit');
  assert.equal(result.receipt?.ticketId, ticket.ticketId);
  console.log('[closure-repair-write-ticket-commit] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}

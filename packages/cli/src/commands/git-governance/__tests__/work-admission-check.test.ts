import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateTaskWorkAdmissionGate } from '../work-admission-check.ts';
import { issueWorkAdmissionTicket } from '../../../../../core/src/broker/work-admission-ticket.ts';
import {
  frameworkTempPublicationCapabilityCovers,
  resolveFrameworkTempPublicationCapability,
} from '../../framework-development/framework-temp-publication-capability.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-framework-temp-admission-'));
const taskId = 'ATM-FRAMEWORK-TEMP-validator';
mkdirSync(path.join(cwd, '.atm', 'runtime', 'locks'), { recursive: true });
writeFileSync(path.join(cwd, '.atm', 'runtime', 'locks', `${taskId}.lock.json`), `${JSON.stringify({
  workItemId: taskId,
  actorId: 'validator',
  lockedAt: '2026-08-09T14:52:53.900Z',
  heartbeatAt: '2026-08-09T14:52:53.900Z',
  ttlSeconds: 3600,
  files: ['packages/cli/src/example.ts']
}, null, 2)}\n`, 'utf8');

const capability = resolveFrameworkTempPublicationCapability({
  cwd,
  taskId,
  actorId: 'validator',
  now: Date.parse('2026-08-09T14:53:00.000Z'),
});
assert.equal(capability?.taskId, taskId);
assert.equal(frameworkTempPublicationCapabilityCovers(capability, ['packages/cli/src/example.ts']), true);
assert.equal(frameworkTempPublicationCapabilityCovers(capability, ['packages/core/src/outside.ts']), false);
assert.equal(resolveFrameworkTempPublicationCapability({
  cwd,
  taskId,
  actorId: 'other-actor',
  now: Date.parse('2026-08-09T14:53:00.000Z'),
}), null);

const admitted = evaluateTaskWorkAdmissionGate({
  cwd,
  taskId,
  operation: 'commit',
  files: ['packages/cli/src/example.ts'],
  producingAtmCommand: 'node atm.mjs git commit',
  now: '2026-08-09T14:53:00.000Z'
});
assert.equal(admitted.decision.ok, true);
assert.equal(admitted.receipt?.actorId, 'validator');

const deniedOutsideScope = evaluateTaskWorkAdmissionGate({
  cwd,
  taskId,
  operation: 'commit',
  files: ['packages/core/src/outside.ts'],
  producingAtmCommand: 'node atm.mjs git commit',
  now: '2026-08-09T14:53:00.000Z'
});
assert.equal(deniedOutsideScope.decision.ok, false);

const terminalTaskId = 'ATM-GOV-terminal-closeback';
mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
const terminalTicket = issueWorkAdmissionTicket({
  taskId: terminalTaskId,
  origin: 'repair-closure',
  actorId: 'closure-steward',
  laneSessionId: null,
  claimGeneration: 'repair-closure:2026-08-09T14:53:00.000Z',
  allowedFiles: [`.atm/history/tasks/${terminalTaskId}.json`],
  runnerSelection: { runnerKind: 'frozen', runnerRef: 'repair-closure', selectedAt: '2026-08-09T14:53:00.000Z' },
  now: '2026-08-09T14:53:00.000Z'
});
writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${terminalTaskId}.json`), `${JSON.stringify({
  taskId: terminalTaskId,
  claim: {
    state: 'released',
    actorId: 'historical-owner',
    leaseId: 'historical-lease',
    laneSession: { laneSessionId: 'historical-lane' }
  },
  workAdmissionTicket: terminalTicket
}, null, 2)}\n`, 'utf8');
const terminalCloseback = evaluateTaskWorkAdmissionGate({
  cwd,
  taskId: terminalTaskId,
  operation: 'commit',
  files: [`.atm/history/tasks/${terminalTaskId}.json`],
  producingAtmCommand: 'node atm.mjs git commit',
  now: '2026-08-09T14:53:01.000Z'
});
assert.equal(terminalCloseback.decision.ok, true, 'terminal repair tickets must preserve their null lane instead of falling back to the released claim lane');
assert.equal(terminalCloseback.receipt?.actorId, 'closure-steward');
console.log('work-admission-check: ok');

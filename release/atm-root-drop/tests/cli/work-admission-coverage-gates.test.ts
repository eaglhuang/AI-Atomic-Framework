import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { issueWorkAdmissionTicket } from '../../packages/core/src/broker/work-admission-ticket.ts';
import { evaluateTaskWorkAdmissionGate, evaluateWorkAdmissionGate } from '../../packages/cli/src/commands/git-governance/work-admission-check.ts';
import { runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-work-admission-gate-'));
try {
  const taskId = 'TASK-GIT-0019';
  const actorId = 'gate-test';
  const laneSessionId = 'lane-gate-test';
  const ticket = issueWorkAdmissionTicket({
    taskId,
    actorId,
    laneSessionId,
    claimGeneration: 'lease-gate-test',
    allowedFiles: ['packages/example.ts'],
    runnerSelection: { runnerKind: 'frozen', runnerRef: 'release/atm-onefile/atm.mjs', selectedAt: '2026-07-29T00:00:00.000Z' },
    now: '2026-07-29T13:00:00.000Z'
  });
  const ledgerDir = path.join(root, '.atm', 'history', 'tasks');
  mkdirSync(ledgerDir, { recursive: true });
  execFileSync('git', ['init', '--initial-branch=main'], { cwd: root, stdio: 'ignore' });
  mkdirSync(path.join(root, 'packages'), { recursive: true });
  writeFileSync(path.join(root, 'packages', 'outside.ts'), 'export const outside = true;\n');
  execFileSync('git', ['add', '--', 'packages/outside.ts'], { cwd: root, stdio: 'ignore' });
  writeFileSync(path.join(ledgerDir, `${taskId}.json`), JSON.stringify({
    workAdmissionTicket: ticket,
    claim: {
      actorId,
      leaseId: 'lease-gate-test',
      laneSession: { laneSessionId }
    }
  }));

  const accepted = evaluateWorkAdmissionGate({
    cwd: root, taskId, actorId, laneSessionId, claimGeneration: 'lease-gate-test',
    operation: 'commit', files: ['packages/example.ts'], producingAtmCommand: 'node atm.mjs git commit',
    now: '2026-07-29T13:01:00.000Z'
  });
  assert.equal(accepted.decision.code, 'ATM_WORK_ADMISSION_OK');
  assert.equal(accepted.receipt?.operation, 'commit');

  const ledgerBound = evaluateTaskWorkAdmissionGate({
    cwd: root, taskId, operation: 'close', files: ['packages/example.ts'],
    producingAtmCommand: 'node atm.mjs taskflow close', now: '2026-07-29T13:01:00.000Z'
  });
  assert.equal(ledgerBound.decision.code, 'ATM_WORK_ADMISSION_OK');
  assert.equal(ledgerBound.receipt?.operation, 'close');

  const rejected = evaluateWorkAdmissionGate({
    cwd: root, taskId, actorId, laneSessionId, claimGeneration: 'lease-gate-test',
    operation: 'push', files: ['packages/outside.ts'], producingAtmCommand: 'node atm.mjs git push',
    now: '2026-07-29T13:01:00.000Z'
  });
  assert.equal(rejected.decision.code, 'ATM_WRITE_TICKET_SCOPE_VIOLATION');
  assert.equal(rejected.receipt, null);

  const tempTaskId = 'ATM-FRAMEWORK-TEMP-gate-test';
  const tempHeartbeatAt = new Date().toISOString();
  mkdirSync(path.join(root, '.atm', 'runtime', 'locks'), { recursive: true });
  writeFileSync(path.join(root, '.atm', 'runtime', 'locks', `${tempTaskId}.lock.json`), JSON.stringify({
    workItemId: tempTaskId, actorId, heartbeatAt: tempHeartbeatAt, ttlSeconds: 300,
    files: ['packages/example.ts']
  }));
  const tempAccepted = evaluateWorkAdmissionGate({
    cwd: root, taskId: tempTaskId, actorId, operation: 'commit', files: ['packages/example.ts'],
    producingAtmCommand: 'node atm.mjs git commit', now: tempHeartbeatAt
  });
  assert.equal(tempAccepted.decision.code, 'ATM_WORK_ADMISSION_OK');

  const facadeRejected = await runAtmGit([
    'commit', '--cwd', root, '--actor', actorId, '--task', taskId,
    '--message', 'should not reach host git', '--json'
  ]);
  assert.equal(facadeRejected.ok, false);
  assert.equal(facadeRejected.messages[0]?.code, 'ATM_WRITE_TICKET_SCOPE_VIOLATION');
} finally {
  rmSync(root, { recursive: true, force: true });
}

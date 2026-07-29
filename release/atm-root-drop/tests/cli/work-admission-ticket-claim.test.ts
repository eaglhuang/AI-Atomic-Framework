import assert from 'node:assert/strict';
import {
  checkWorkAdmissionTicket,
  createWorkAdmissionCoverageReceipt,
  createWorkAdmissionSnapshotPlan,
  issueWorkAdmissionTicket
} from '../../packages/core/src/broker/work-admission-ticket.ts';
import { validateWorkAdmissionImport } from '../../packages/cli/src/commands/tasks/task-work-admission-import.ts';

const runner = {
  runnerKind: 'frozen' as const,
  runnerRef: 'release/atm-onefile/atm.mjs@abc123',
  selectedAt: '2026-07-29T00:00:00.000Z'
};

const lowRisk = issueWorkAdmissionTicket({
  taskId: 'TASK-GIT-0018',
  actorId: 'worker-a',
  laneSessionId: 'lane-a',
  claimGeneration: 'lease-a',
  allowedFiles: ['packages/core/src/example.ts'],
  requestedRecoveryMode: 'auto',
  runnerSelection: runner,
  now: '2026-07-29T00:00:00.000Z'
});

assert.equal(lowRisk.recovery.resolvedMode, 'disabled');
assert.equal(createWorkAdmissionSnapshotPlan(lowRisk).enabled, false);
assert.equal(lowRisk.recovery.maxSavePoints, 0);

const elevated = issueWorkAdmissionTicket({
  taskId: 'TASK-GIT-0018',
  actorId: 'worker-a',
  laneSessionId: 'lane-a',
  claimGeneration: 'lease-a',
  allowedFiles: ['packages/core/src/example.ts'],
  requestedRecoveryMode: 'auto',
  runnerSelection: runner,
  elevatedRisk: { sharedSurface: true, workerEvidence: 'unproven' },
  now: '2026-07-29T00:00:00.000Z'
});

assert.equal(elevated.recovery.resolvedMode, 'enabled');
assert.equal(elevated.recovery.maxSavePoints, 2);
assert.equal(createWorkAdmissionSnapshotPlan(elevated).preRiskSavePoint, 'replaceable');

const allowed = checkWorkAdmissionTicket({
  ticket: elevated,
  taskId: 'TASK-GIT-0018',
  actorId: 'worker-a',
  laneSessionId: 'lane-a',
  claimGeneration: 'lease-a',
  files: ['packages/core/src/example.ts'],
  operation: 'write',
  runnerSelection: runner,
  now: '2026-07-29T00:00:01.000Z'
});
assert.equal(allowed.ok, true);

assert.equal(checkWorkAdmissionTicket({
  ticket: elevated,
  taskId: 'TASK-GIT-0018',
  actorId: 'worker-a',
  laneSessionId: 'lane-a',
  claimGeneration: 'lease-a',
  files: ['outside.ts'],
  operation: 'write',
  runnerSelection: runner,
  now: '2026-07-29T00:00:01.000Z'
}).code, 'ATM_WRITE_TICKET_SCOPE_VIOLATION');

const receipt = createWorkAdmissionCoverageReceipt({
  ticket: elevated,
  operation: 'write',
  path: 'packages/core/src/example.ts',
  baseContent: 'before',
  observedContent: 'after',
  producingAtmCommand: 'node atm.mjs write-ticket record-touch --task TASK-GIT-0018'
});
assert.notEqual(receipt.baseDigest, receipt.observedDigest);
assert.equal(receipt.ticketId, elevated.ticketId);

const importedAuto = validateWorkAdmissionImport({ workAdmission: { recoveryMode: 'auto' } });
assert.equal(importedAuto.policy.recoveryMode, 'auto');
assert.equal(importedAuto.diagnostics.length, 0);

const invalidImport = validateWorkAdmissionImport({ workAdmission: { recoveryMode: 'continuous' } });
assert.equal(invalidImport.policy.recoveryMode, 'auto');
assert.equal(invalidImport.diagnostics[0]?.code, 'ATM_WORK_ADMISSION_RECOVERY_MODE_INVALID');

console.log(JSON.stringify({
  marker: '[work-admission-ticket-claim.test] ok',
  ticketId: elevated.ticketId,
  recoveryMode: elevated.recovery.resolvedMode
}));

import assert from 'node:assert/strict';
import { checkWorkAdmissionTicket, issueWorkAdmissionTicket, type WorkAdmissionOperation } from '../../packages/core/src/broker/work-admission-ticket.ts';
import { resolveTaskWorkAdmissionFiles } from '../../packages/cli/src/commands/tasks/claim-work-admission.ts';

const ticket = issueWorkAdmissionTicket({
  taskId: 'TASK-GIT-0025',
  actorId: 'fixture-actor',
  laneSessionId: 'lane-fixture',
  claimGeneration: 'claim-fixture',
  allowedFiles: [
    '.atm/history/evidence/TASK-GIT-0025.*',
    'packages/cli/src/commands/**/*.ts'
  ],
  runnerSelection: { runnerKind: 'frozen', runnerRef: 'fixture', selectedAt: '2026-07-29T00:00:00.000Z' },
  now: '2026-07-29T00:00:00.000Z'
});

for (const operation of ['write', 'stage', 'commit', 'close', 'push'] as const satisfies readonly WorkAdmissionOperation[]) {
  const decision = checkWorkAdmissionTicket({
    ticket,
    taskId: 'TASK-GIT-0025',
    actorId: 'fixture-actor',
    laneSessionId: 'lane-fixture',
    claimGeneration: 'claim-fixture',
    files: ['.atm/history/evidence/TASK-GIT-0025.runner-sync-receipt.json', 'packages/cli/src/commands/next/route-resolution/pending-worktree.ts'],
    operation,
    now: '2026-07-29T00:01:00.000Z'
  });
  assert.equal(decision.ok, true, `${operation} must use the canonical glob matcher for ticket scope`);
}

const denied = checkWorkAdmissionTicket({
  ticket,
  taskId: 'TASK-GIT-0025',
  actorId: 'fixture-actor',
  laneSessionId: 'lane-fixture',
  claimGeneration: 'claim-fixture',
  files: ['docs/governance/error-code-registry.json'],
  operation: 'commit',
  now: '2026-07-29T00:01:00.000Z'
});
assert.equal(denied.code, 'ATM_WRITE_TICKET_SCOPE_VIOLATION');

const claimScope = resolveTaskWorkAdmissionFiles({
  workItemId: 'TASK-GIT-0025',
  taskDirectionLock: { allowedFiles: ['packages/cli/src/commands/next/playbook-projection/task-reservation-projection.ts'] }
}, []);
const claimTicket = issueWorkAdmissionTicket({
  taskId: 'TASK-GIT-0025', actorId: 'fixture-actor', laneSessionId: 'lane-fixture', claimGeneration: 'claim-fixture',
  allowedFiles: claimScope,
  runnerSelection: { runnerKind: 'frozen', runnerRef: 'fixture', selectedAt: '2026-07-29T00:00:00.000Z' },
  now: '2026-07-29T00:00:00.000Z'
});
const lifecycleDecision = checkWorkAdmissionTicket({
  ticket: claimTicket, taskId: 'TASK-GIT-0025', actorId: 'fixture-actor', laneSessionId: 'lane-fixture', claimGeneration: 'claim-fixture',
  files: ['.atm/history/evidence/TASK-GIT-0025.closure-packet.json', '.atm/history/task-events/TASK-GIT-0025/close.json', '.atm/history/tasks/TASK-GIT-0025.json'],
  operation: 'commit', now: '2026-07-29T00:01:00.000Z'
});
assert.equal(lifecycleDecision.ok, true, 'a claim ticket must authorize its own lifecycle close bundle');
const legacyTicket = issueWorkAdmissionTicket({
  taskId: 'TASK-GIT-0025', actorId: 'fixture-actor', laneSessionId: 'lane-fixture', claimGeneration: 'claim-fixture',
  allowedFiles: ['packages/cli/src/commands/next/playbook-projection/task-reservation-projection.ts'],
  runnerSelection: { runnerKind: 'frozen', runnerRef: 'fixture', selectedAt: '2026-07-29T00:00:00.000Z' },
  now: '2026-07-29T00:00:00.000Z'
});
assert.equal(checkWorkAdmissionTicket({
  ticket: legacyTicket, taskId: 'TASK-GIT-0025', actorId: 'fixture-actor', laneSessionId: 'lane-fixture', claimGeneration: 'claim-fixture',
  files: ['.atm/history/evidence/TASK-GIT-0025.closure-packet.json'], operation: 'commit', now: '2026-07-29T00:01:00.000Z'
}).ok, true, 'legacy tickets must retain authority over their own lifecycle records');
console.log('[work-admission-ticket-scope-glob-parity.test] ok');

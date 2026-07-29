import assert from 'node:assert/strict';
import { describeRestrictedExecutionAdapterCapability, evaluateRestrictedExecution } from '../../packages/core/src/team-agents/restricted-execution-gateway.ts';
import { issueWorkAdmissionTicket } from '../../packages/core/src/broker/work-admission-ticket.ts';

const ticket = issueWorkAdmissionTicket({
  taskId: 'TASK-GIT-0019',
  actorId: 'adapter-test',
  laneSessionId: 'lane-adapter-test',
  claimGeneration: 'lease-adapter-test',
  allowedFiles: ['packages/example.ts'],
  runnerSelection: { runnerKind: 'frozen', runnerRef: 'release/atm-onefile/atm.mjs', selectedAt: '2026-07-29T00:00:00.000Z' },
  now: '2026-07-29T00:00:00.000Z'
});

for (const adapterId of ['claude-code', 'codex', 'cursor', 'gemini', 'copilot', 'antigravity']) {
  const result = evaluateRestrictedExecution({
    actor: 'adapter-test', taskId: 'TASK-GIT-0019', laneSessionId: 'lane-adapter-test',
    claimGeneration: 'lease-adapter-test', executionClass: 'external-worker-process',
    executable: 'node', argv: ['atm.mjs', 'git', 'commit', '--json'],
    declaredOutputs: ['packages/example.ts'], workAdmissionTicket: ticket,
    adapterCapability: describeRestrictedExecutionAdapterCapability(adapterId), now: '2026-07-29T00:01:00.000Z'
  });
  if (['claude-code', 'copilot'].includes(adapterId)) {
    assert.equal(result.decision, 'allow', `${adapterId} should support an enforced pre-tool route`);
  } else {
    assert.equal(result.reasonCode, 'external-write-capability-unsupported', `${adapterId} must fail closed without an enforcing hook`);
  }
}

const rawPush = evaluateRestrictedExecution({
  executionClass: 'editor-pre-tool', executable: 'git', argv: ['push', 'origin', 'main']
});
assert.equal(rawPush.reasonCode, 'raw-git-mutation');

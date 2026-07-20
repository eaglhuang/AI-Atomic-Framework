import assert from 'node:assert/strict';
import {
  buildLaneLifecycleReconcileCommand,
  evaluateLaneLifecycleMismatch,
  normalizeLaneScopePaths
} from '../../packages/core/src/lane/lifecycle.ts';

const mismatch = evaluateLaneLifecycleMismatch({
  taskId: 'TASK LANE 1',
  actorId: 'agent b',
  current: { actorId: 'agent-a', laneSessionId: 'lane-a' },
  requested: { actorId: 'agent-b', laneSessionId: 'lane-b' }
});

assert.equal(mismatch.sameOwner, false);
assert.equal(mismatch.mode, 'lane-id');
assert.match(mismatch.requiredCommand ?? '', /^node atm\.mjs tasks repair-claim /);
assert.match(mismatch.requiredCommand ?? '', /--task "TASK LANE 1"/);
assert.match(mismatch.requiredCommand ?? '', /--actor "agent b"/);
assert.match(mismatch.requiredCommand ?? '', /--write/);

assert.equal(
  buildLaneLifecycleReconcileCommand({
    taskId: 'ATM-GOV-0220',
    actorId: 'codex-gpt-5.4-mini',
    reason: 'actor/lane mismatch'
  }),
  'node atm.mjs tasks repair-claim --task ATM-GOV-0220 --actor codex-gpt-5.4-mini --write --reason "actor/lane mismatch" --json'
);

assert.deepEqual(
  normalizeLaneScopePaths([
    '"packages\\cli\\src\\commands\\tasks\\space file.ts"',
    'packages/cli/src/commands/tasks/*.ts',
    'packages\\cli\\src\\commands\\tasks\\space file.ts'
  ]),
  [
    'packages/cli/src/commands/tasks/*.ts',
    'packages/cli/src/commands/tasks/space file.ts'
  ]
);

console.log('[task-lane-lifecycle-repair] ok');

import assert from 'node:assert/strict';

import { pruneTerminalQueueTasks } from '../../packages/cli/src/commands/next/route-resolution/queue-inspection.ts';
import { createDeterministicTaskIntent } from '../../packages/cli/src/commands/next/route-resolution/intent.ts';
import type { ImportedTaskSummary } from '../../packages/cli/src/commands/next/route-predicates.ts';

function task(workItemId: string, status: string, overrides: Partial<ImportedTaskSummary> = {}): ImportedTaskSummary {
  return {
    workItemId,
    title: workItemId,
    status,
    closedAt: status === 'done' ? '2026-07-24T00:00:00.000Z' : null,
    closedByActor: status === 'done' ? 'actor-a' : null,
    closurePacket: null,
    lastTransitionId: null,
    lastTransitionAt: null,
    milestone: null,
    dependencies: [],
    taskPath: `.atm/history/tasks/${workItemId}.json`,
    format: 'json',
    sourcePlanPath: null,
    nearbyPlanPaths: [],
    scopePaths: [],
    targetRepo: null,
    planningRepo: null,
    allowPlanningMirror: false,
    planningReadOnlyPaths: [],
    planningMirrorPaths: [],
    targetAllowedFiles: [],
    closureAuthority: null,
    activeClaimActorId: null,
    activeClaimLaneSessionId: null,
    activeClaimIntent: null,
    ...overrides
  };
}

// A queue whose head is already done must advance to the next unblocked task.
const queue = [
  task('ATM-GOV-A', 'done'),
  task('ATM-GOV-B', 'abandoned'),
  task('ATM-GOV-C', 'ready'),
  task('ATM-GOV-D', 'open')
];
const pruned = pruneTerminalQueueTasks(queue);
assert.deepEqual(pruned.map((t) => t.workItemId), ['ATM-GOV-C', 'ATM-GOV-D']);
assert.equal(pruned[0].workItemId, 'ATM-GOV-C', 'queue head must skip the done prerequisite');

// A non-terminal queue is unchanged.
const active = [task('ATM-GOV-E', 'ready'), task('ATM-GOV-F', 'running')];
assert.equal(pruneTerminalQueueTasks(active).length, 2);

// closedAt / closedByActor markers count as terminal even if status lags.
const laggingStatus = [task('ATM-GOV-G', 'running', { closedAt: '2026-07-24T00:00:00.000Z' }), task('ATM-GOV-H', 'ready')];
assert.deepEqual(pruneTerminalQueueTasks(laggingStatus).map((t) => t.workItemId), ['ATM-GOV-H']);

// An explicitly named terminal task is kept so status/redo/reopen still resolve.
const intent = createDeterministicTaskIntent('redo ATM-GOV-0001', ['ATM-GOV-0001']);
assert.ok(intent.mentionedTaskIds.includes('ATM-GOV-0001'), 'fixture intent must mention the task id');
const keptExplicit = pruneTerminalQueueTasks([task('ATM-GOV-0001', 'done'), task('ATM-GOV-C', 'ready')], intent);
assert.ok(keptExplicit.some((t) => t.workItemId === 'ATM-GOV-0001'), 'explicitly named done task must be retained');

// An empty queue prunes to empty.
assert.deepEqual(pruneTerminalQueueTasks([]), []);

console.log('batch-done-task-pruning.test passed');

import assert from 'node:assert/strict';
import { buildTaskScopedClaimCommand } from '../task-scoped-claim-command.ts';
import { decideActiveBatchClaimTask, preservesExplicitTaskClaim } from '../../next-active-batch.ts';

const explicitTask = buildTaskScopedClaimCommand({
  selectedTaskId: 'TASK-RFT-0001',
  explicitTaskSelector: 'TASK-RFT-0001',
  userPrompt: 'finish RFT-0001'
});
assert.ok(explicitTask);
assert.equal(explicitTask.claimCommandShape, 'task-scoped');
assert.match(explicitTask.normalClaimCommand, /--task TASK-RFT-0001/);
assert.match(explicitTask.taskScopedClaimCommand, /--task TASK-RFT-0001/);

const promptResolved = buildTaskScopedClaimCommand({
  selectedTaskId: 'TASK-RFT-0002',
  explicitTaskSelector: null,
  userPrompt: 'continue next.ts extraction'
});
assert.ok(promptResolved);
assert.equal(promptResolved.claimCommandShape, 'prompt-scoped');
assert.match(promptResolved.normalClaimCommand, /--prompt/);
assert.match(promptResolved.taskScopedClaimCommand, /--task TASK-RFT-0002/);

assert.equal(buildTaskScopedClaimCommand({
  selectedTaskId: null,
  explicitTaskSelector: null,
  userPrompt: 'orphan prompt'
}), null);

const explicitBatchDecision = preservesExplicitTaskClaim(['TASK-TARGET-0001']) ? null : decideActiveBatchClaimTask({
  activeBatch: {
    batchId: 'batch-stale',
    status: 'active',
    currentTaskId: 'TASK-OTHER-0001',
    taskIds: ['TASK-TARGET-0001', 'TASK-OTHER-0001'],
    sourcePrompt: 'continue all tasks'
  } as any,
  activeQueue: null,
  claimableTask: { workItemId: 'TASK-TARGET-0001' },
  visibleTasks: [{ workItemId: 'TASK-TARGET-0001' }, { workItemId: 'TASK-OTHER-0001' }],
  fallbackTasks: []
});
assert.equal(explicitBatchDecision, null, 'an explicit --task must not be silently replaced by a batch head');

const broadBatchDecision = decideActiveBatchClaimTask({
  activeBatch: {
    batchId: 'batch-stale',
    status: 'active',
    currentTaskId: 'TASK-OTHER-0001',
    taskIds: ['TASK-TARGET-0001', 'TASK-OTHER-0001'],
    sourcePrompt: 'continue all tasks'
  } as any,
  activeQueue: null,
  claimableTask: { workItemId: 'TASK-TARGET-0001' },
  visibleTasks: [{ workItemId: 'TASK-TARGET-0001' }, { workItemId: 'TASK-OTHER-0001' }],
  fallbackTasks: []
});
assert.equal(broadBatchDecision?.kind, 'use-queue-head', 'broad continuation keeps batch queue semantics');
assert.equal(broadBatchDecision?.kind === 'use-queue-head' ? broadBatchDecision.task.workItemId : null, 'TASK-OTHER-0001');

console.log('[task-scoped-claim-command.spec] ok');

import assert from 'node:assert/strict';
import { buildTaskScopedClaimCommand } from '../task-scoped-claim-command.js';
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
console.log('[task-scoped-claim-command.spec] ok');

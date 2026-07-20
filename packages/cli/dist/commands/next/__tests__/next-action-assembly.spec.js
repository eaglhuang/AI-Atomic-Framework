import assert from 'node:assert/strict';
import { buildDecisionTrail, ensureDecisionTrail, readQueueHeadTaskId, readTaskId } from '../next-action-assembly.js';
import { buildPromptScopedQueueClaimCommand } from '../prompt-scope-resolution.js';
import { shouldEmitPromptWorktreeHint } from '../worktree-hints.js';
const queueAction = {
    status: 'task-queue-ready',
    command: 'node atm.mjs next --claim --actor <id> --prompt "RFT" --auto-intent --json',
    reason: 'queue head selected',
    recommendedChannel: 'batch',
    riskLevel: 'high',
    selectedTasks: [{ workItemId: 'TASK-RFT-0022' }],
    taskQueue: { queueHeadTaskId: 'TASK-RFT-0022' },
    blockedCommands: ['tasks close'],
    allowedCommands: ['next --claim']
};
const trail = buildDecisionTrail(queueAction);
assert.deepEqual(trail.map((entry) => entry.check), [
    'route-status',
    'task-selection',
    'work-channel',
    'queue-head',
    'allowed-commands',
    'blocked-commands'
]);
assert.equal(trail[0]?.result, 'pass');
assert.equal(trail[3]?.reason, 'Current queue head is TASK-RFT-0022.');
const reusedAction = {
    status: 'ready',
    decisionTrail: [{ check: 'custom', result: 'info', reason: 'preserved' }]
};
assert.equal(ensureDecisionTrail(reusedAction), reusedAction);
assert.equal(reusedAction.decisionTrail.length, 1);
assert.equal(readTaskId({ workItemId: ' TASK-1 ' }), 'TASK-1');
assert.equal(readQueueHeadTaskId({ queueHeadTaskId: 'TASK-2' }), 'TASK-2');
assert.equal(readTaskId({ id: 'TASK-1' }), null);
assert.equal(buildPromptScopedQueueClaimCommand({
    queueHeadTaskPresent: true,
    queuePrompt: '請完成 "RFT" queue',
    planningCardImportCommand: null
}), 'node atm.mjs next --claim --actor <id> --prompt "請完成 \\"RFT\\" queue" --auto-intent --json');
assert.equal(buildPromptScopedQueueClaimCommand({
    queueHeadTaskPresent: true,
    queuePrompt: 'ignored',
    planningCardImportCommand: 'node atm.mjs tasks import --from task.md --json'
}), 'node atm.mjs tasks import --from task.md --json');
assert.equal(buildPromptScopedQueueClaimCommand({
    queueHeadTaskPresent: false,
    queuePrompt: 'ignored'
}), 'node atm.mjs next --prompt "<current user prompt>" --json');
const emptyHint = {
    promptMatchedFiles: [],
    atmManagedFiles: [],
    generatedArtifactFiles: [],
    releaseMirrorFiles: [],
    unrelatedTrackedFiles: [],
    unrelatedUntrackedFiles: [],
    ignoredArtifactCount: 0
};
assert.equal(shouldEmitPromptWorktreeHint(emptyHint), false);
assert.equal(shouldEmitPromptWorktreeHint({ ...emptyHint, releaseMirrorFiles: ['release/atm-onefile/atm.mjs'] }), true);
assert.equal(shouldEmitPromptWorktreeHint({ ...emptyHint, ignoredArtifactCount: 1 }), true);
console.log(JSON.stringify({ ok: true, assertions: 16 }, null, 2));

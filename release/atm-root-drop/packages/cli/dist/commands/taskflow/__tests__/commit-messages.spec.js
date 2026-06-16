import assert from 'node:assert/strict';
import { buildTaskflowCommitMessage } from '../commit-messages.js';
const taskId = 'TASK-RFT-0008';
assert.equal(buildTaskflowCommitMessage('target', { taskId }), 'chore(taskflow): close TASK-RFT-0008 target governance bundle');
assert.equal(buildTaskflowCommitMessage('planning', { taskId }), 'docs(taskflow): close TASK-RFT-0008 planning bundle');
assert.equal(buildTaskflowCommitMessage('target', {
    taskId,
    profile: {
        delegation: {
            policy: {
                commitMessage: {
                    targetTemplate: 'custom target close message'
                }
            }
        }
    }
}), 'custom target close message');
assert.equal(buildTaskflowCommitMessage('planning', {
    taskId,
    profile: {
        delegation: {
            policy: {}
        }
    }
}), 'docs(taskflow): close TASK-RFT-0008 planning bundle');
assert.equal(buildTaskflowCommitMessage('target', {
    taskId,
    profile: {
        delegation: {
            policy: {
                commitMessage: {
                    targetTemplate: 'custom ${taskId} close message'
                }
            }
        }
    }
}), 'custom ${taskId} close message', 'profile-provided templates are raw labels, not format strings');
console.log('[taskflow-commit-messages:test] ok');

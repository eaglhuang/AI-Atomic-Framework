import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decideCheckpointContinuation } from './checkpoint-commit-window-policy.ts';

const afterCheckpoint = decideCheckpointContinuation({ closedTaskId: 'TASK-A', nextTaskId: 'TASK-B' });
assert.equal(afterCheckpoint.state, 'pending-commit');
assert.equal(afterCheckpoint.mayClaimNext, false);
assert.equal(afterCheckpoint.pendingCommitTaskId, 'TASK-A');

const dirtyResume = decideCheckpointContinuation({ closedTaskId: null, nextTaskId: 'TASK-B', pendingWindowTaskId: 'TASK-A' });
assert.equal(dirtyResume.state, 'pending-commit');
assert.equal(dirtyResume.mayClaimNext, false);

const committedResume = decideCheckpointContinuation({ closedTaskId: null, nextTaskId: 'TASK-B', pendingWindowTaskId: null });
assert.equal(committedResume.state, 'ready-to-resume');
assert.equal(committedResume.mayClaimNext, true);

const finalCheckpoint = decideCheckpointContinuation({ closedTaskId: 'TASK-A', nextTaskId: null });
assert.equal(finalCheckpoint.state, 'complete');
assert.equal(finalCheckpoint.mayClaimNext, false);

const implementation = readFileSync(new URL('./implementation.ts', import.meta.url), 'utf8');
const checkpointSlice = implementation.slice(implementation.indexOf("if (action === 'checkpoint')"), implementation.indexOf("if (action === 'deliver-and-close')"));
assert.doesNotMatch(checkpointSlice, /await runNext\(/, 'checkpoint wiring must not claim the next task before commit');
assert.match(implementation, /ATM_BATCH_PENDING_COMMIT_REQUIRED/, 'resume wiring must fail closed while the checkpoint window remains dirty');
assert.match(implementation, /pendingCommitTaskId: null/, 'successful resume must clear the durable pending-commit marker');

console.log('[checkpoint-commit-window-policy.test] ok');

// TASK-RFT-0013 spec — task-transition-writer surface.
import { writeTaskDocumentWithTransition, buildTaskTransitionCommand, createClosureTransitionMetadata } from '../close-helpers/task-transition-writer.js';
function fail(msg) {
    console.error(`[close-helpers-task-transition-writer.spec] ${msg}`);
    process.exitCode = 1;
    throw new Error(msg);
}
function assert(cond, msg) { if (!cond)
    fail(msg); }
// happy path — buildTaskTransitionCommand exports a function.
assert(typeof buildTaskTransitionCommand === 'function', 'buildTaskTransitionCommand exported');
const cmd = buildTaskTransitionCommand({
    action: 'close',
    taskId: 'TASK-RFT-0013',
    actorId: 'test-actor',
    status: 'done'
});
assert(cmd.includes('tasks close') && cmd.includes('TASK-RFT-0013'), 'command string contains action + task');
// failure — createClosureTransitionMetadata returns null when all inputs are empty.
const empty = createClosureTransitionMetadata(null, null, null, null);
assert(empty === null, 'empty inputs -> null metadata');
// rollback / recovery — metadata builder tolerates minimal input.
const meta = createClosureTransitionMetadata('some/path', null, 'BATCH-1', 'SESS-1');
assert(meta !== null && meta.batchId === 'BATCH-1', 'metadata built from batchId');
// surface — writeTaskDocumentWithTransition is a function.
assert(typeof writeTaskDocumentWithTransition === 'function', 'writeTaskDocumentWithTransition exported');
console.log('[close-helpers-task-transition-writer.spec] ok (4 branches)');

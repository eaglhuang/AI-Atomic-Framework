/**
 * Unit tests for `buildTaskTransitionCommand` helper.
 * Cluster: task-transition-helpers (TASK-AAO-0100)
 */
import assert from 'node:assert/strict';
import { buildTaskTransitionCommand } from '../../packages/cli/src/commands/tasks/task-transition-helpers.ts';

// Test 1: basic command with taskId and actorId
const cmd1 = buildTaskTransitionCommand({ action: 'close', taskId: 'TASK-001', actorId: 'agent-a' });
assert.ok(cmd1.includes('node atm.mjs tasks close'), 'should include command prefix');
assert.ok(cmd1.includes('--task TASK-001'), 'should include task flag');
assert.ok(cmd1.includes('--actor agent-a'), 'should include actor flag');

// Test 2: null actorId is omitted
const cmd2 = buildTaskTransitionCommand({ action: 'reserve', taskId: 'TASK-002', actorId: null });
assert.ok(!cmd2.includes('--actor'), 'null actor should not appear');
assert.ok(cmd2.includes('--task TASK-002'), 'task should still appear');

// Test 3: status flag is appended
const cmd3 = buildTaskTransitionCommand({ action: 'promote', taskId: 'TASK-003', actorId: null, status: 'ready' });
assert.ok(cmd3.includes('--status ready'), 'status should be included');

// Test 4: fromBatchCheckpoint flag
const cmd4 = buildTaskTransitionCommand({ action: 'deliver', taskId: 'TASK-004', actorId: null, fromBatchCheckpoint: true });
assert.ok(cmd4.includes('--from-batch-checkpoint'), 'fromBatchCheckpoint flag should appear');

// Test 5: batchId is appended
const cmd5 = buildTaskTransitionCommand({ action: 'claim', taskId: 'TASK-005', actorId: 'agent-b', batchId: 'BATCH-001' });
assert.ok(cmd5.includes('--batch BATCH-001'), 'batchId should appear');

// Test 6: historicalDeliveryRefs are appended
const cmd6 = buildTaskTransitionCommand({ action: 'close', taskId: 'TASK-006', actorId: null, historicalDeliveryRefs: ['ref-a', 'ref-b'] });
assert.ok(cmd6.includes('--historical-delivery ref-a'), 'first ref should appear');
assert.ok(cmd6.includes('--historical-delivery ref-b'), 'second ref should appear');

// Test 7: values with special chars are quoted
const cmd7 = buildTaskTransitionCommand({ action: 'close', taskId: 'TASK-007', actorId: 'agent with space' });
assert.ok(cmd7.includes('"agent with space"'), 'actor with spaces should be quoted');

// Test 8: returns a string
assert.equal(typeof cmd1, 'string');

console.log('[unit:build-task-transition-command-helper] ok (8+ assertions)');

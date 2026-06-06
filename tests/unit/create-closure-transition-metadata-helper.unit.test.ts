/**
 * Unit tests for `createClosureTransitionMetadata` helper.
 * Cluster: task-transition-helpers (TASK-AAO-0100)
 */
import assert from 'node:assert/strict';
import { createClosureTransitionMetadata } from '../../packages/cli/src/commands/tasks/task-transition-helpers.ts';

// Test 1: returns null when all inputs are null
const result1 = createClosureTransitionMetadata(null, null, null, null);
assert.equal(result1, null, 'should return null when all params are null');

// Test 2: returns object when closurePacketPath is provided
const result2 = createClosureTransitionMetadata('/some/path.json', null, null, null);
assert.ok(result2 !== null, 'should return object when path is given');
assert.equal(result2?.schemaId, 'atm.taskClosureTransition.v1');

// Test 3: batchId is propagated
const result3 = createClosureTransitionMetadata(null, null, 'BATCH-001', null);
assert.ok(result3 !== null);
assert.equal(result3?.batchId, 'BATCH-001');

// Test 4: sessionId is propagated
const result4 = createClosureTransitionMetadata(null, null, null, 'session-abc');
assert.ok(result4 !== null);
assert.equal(result4?.sessionId, 'session-abc');

// Test 5: closurePacketPath propagated correctly
const result5 = createClosureTransitionMetadata('/evidence.json', null);
assert.equal(result5?.closurePacketPath, '/evidence.json');

// Test 6: evidenceFreshness null when packet is null
const result6 = createClosureTransitionMetadata('/path.json', null);
assert.equal(result6?.evidenceFreshness, null);

// Test 7: validationPasses empty array when packet is null
assert.ok(Array.isArray(result6?.validationPasses));
assert.equal(result6?.validationPasses.length, 0);

// Test 8: requiredGatesSnapshot null when packet is null
assert.equal(result6?.requiredGatesSnapshot, null);

// Test 9: schemaId always set
assert.equal(result6?.schemaId, 'atm.taskClosureTransition.v1');

console.log('[unit:create-closure-transition-metadata-helper] ok (9 assertions)');

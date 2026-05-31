/**
 * Unit tests for `normalizeWorkItemStatus` helper.
 * Cluster: task-transition-helpers (TASK-AAO-0100)
 */
import assert from 'node:assert/strict';
import { normalizeWorkItemStatus } from '../../packages/cli/src/commands/tasks/task-transition-helpers.ts';

// Test 1: 'planned' -> 'planned'
assert.equal(normalizeWorkItemStatus('planned'), 'planned');

// Test 2: 'done' -> 'done'
assert.equal(normalizeWorkItemStatus('done'), 'done');

// Test 3: 'open' aliases to 'ready'
assert.equal(normalizeWorkItemStatus('open'), 'ready');

// Test 4: 'in_progress' aliases to 'ready'
assert.equal(normalizeWorkItemStatus('in_progress'), 'ready');

// Test 5: unknown string -> 'planned'
assert.equal(normalizeWorkItemStatus('unknown-xyz'), 'planned');

// Test 6: null -> 'planned'
assert.equal(normalizeWorkItemStatus(null), 'planned');

// Test 7: uppercase is normalized
assert.equal(normalizeWorkItemStatus('DONE'), 'done');

// Test 8: 'reserved' is a valid pass-through
assert.equal(normalizeWorkItemStatus('reserved'), 'reserved');

// Test 9: 'blocked' is a valid pass-through
assert.equal(normalizeWorkItemStatus('blocked'), 'blocked');

// Test 10: 'abandoned' is a valid pass-through
assert.equal(normalizeWorkItemStatus('abandoned'), 'abandoned');

console.log('[unit:normalize-work-item-status-helper] ok (10 assertions)');

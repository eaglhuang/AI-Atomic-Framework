/**
 * Unit tests for `inspectTaskVerifyStatus` helper.
 * Cluster: task-transition-helpers (TASK-AAO-0100)
 */
import assert from 'node:assert/strict';
import { inspectTaskVerifyStatus } from '../../packages/cli/src/commands/tasks/task-transition-helpers.ts';

// Test 1: 'done' is valid
const r1 = inspectTaskVerifyStatus('done');
assert.equal(r1.ok, true);
assert.equal(r1.normalizedStatus, 'done');
assert.equal(r1.warningCode, null);

// Test 2: 'planned' is valid
const r2 = inspectTaskVerifyStatus('planned');
assert.equal(r2.ok, true);
assert.equal(r2.normalizedStatus, 'planned');

// Test 3: 'closed' aliases to 'done' with warning
const r3 = inspectTaskVerifyStatus('closed');
assert.equal(r3.ok, true);
assert.equal(r3.normalizedStatus, 'done');
assert.equal(r3.warningCode, 'ATM_TASKS_VERIFY_LEGACY_STATUS_ALIAS');

// Test 4: 'completed' aliases to 'done' with warning
const r4 = inspectTaskVerifyStatus('completed');
assert.equal(r4.ok, true);
assert.equal(r4.normalizedStatus, 'done');
assert.equal(r4.warningCode, 'ATM_TASKS_VERIFY_LEGACY_STATUS_ALIAS');

// Test 5: unknown status returns ok=false
const r5 = inspectTaskVerifyStatus('whatever-xyz');
assert.equal(r5.ok, false);
assert.equal(r5.normalizedStatus, null);

// Test 6: null input returns ok=false
const r6 = inspectTaskVerifyStatus(null);
assert.equal(r6.ok, false);

// Test 7: 'review' is valid
const r7 = inspectTaskVerifyStatus('review');
assert.equal(r7.ok, true);

// Test 8: uppercase is normalized (case-insensitive)
const r8 = inspectTaskVerifyStatus('DONE');
assert.equal(r8.ok, true);
assert.equal(r8.normalizedStatus, 'done');

// Test 9: 'in_progress' is valid
const r9 = inspectTaskVerifyStatus('in_progress');
assert.equal(r9.ok, true);

console.log('[unit:inspect-task-verify-status-helper] ok (9 assertions)');

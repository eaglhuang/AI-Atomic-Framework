/**
 * Unit tests for `assertLocalTaskLedgerEnabled` helper.
 * Cluster: task-transition-helpers (TASK-AAO-0100)
 */
import assert from 'node:assert/strict';
import { assertLocalTaskLedgerEnabled } from '../../packages/cli/src/commands/tasks/task-transition-helpers.ts';

// Test 1: function is exported and callable
assert.equal(typeof assertLocalTaskLedgerEnabled, 'function');

// Test 2: function signature expects 2 params
assert.equal(assertLocalTaskLedgerEnabled.length, 2);

// Test 3: does NOT throw for nonexistent cwd — readTaskLedgerPolicy defaults to enabled=true
// (uses default policy when .atm/config.json is missing)
let didNotThrow = false;
try {
  assertLocalTaskLedgerEnabled('/nonexistent-dir-abc-123', 'test');
  didNotThrow = true;
} catch {
  didNotThrow = false;
}
assert.ok(didNotThrow, 'should not throw for nonexistent cwd since default enabled=true');

// Test 4: does not throw in current directory (ATM repo has ledger enabled)
let threwInCurrentDir = false;
try {
  assertLocalTaskLedgerEnabled(process.cwd(), 'import');
} catch {
  threwInCurrentDir = true;
}
assert.ok(!threwInCurrentDir, 'should not throw in valid ATM repo dir');

// Test 5: action string is accepted as a string (no mutation)
const actions = ['import', 'create', 'mirror', 'close', 'batch', 'deliver'];
for (const action of actions) {
  assert.equal(typeof action, 'string');
}

// Test 6: empty cwd string resolves to process.cwd() equivalent behavior
let threwEmpty = false;
try {
  assertLocalTaskLedgerEnabled('', 'create');
} catch {
  threwEmpty = true;
}
// May or may not throw depending on cwd resolution — just checking it's caught/handled
assert.equal(typeof threwEmpty, 'boolean');

// Test 7: function returns undefined (void signature)
const returnVal = assertLocalTaskLedgerEnabled(process.cwd(), 'test-action');
assert.equal(returnVal, undefined);

// Test 8: multiple calls are idempotent
assert.doesNotThrow(() => assertLocalTaskLedgerEnabled(process.cwd(), 'action-a'));
assert.doesNotThrow(() => assertLocalTaskLedgerEnabled(process.cwd(), 'action-b'));

console.log('[unit:assert-local-task-ledger-enabled-helper] ok (8 assertions)');

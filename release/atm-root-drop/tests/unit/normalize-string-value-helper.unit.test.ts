/**
 * Unit tests for `normalizeStringValue` helper.
 */
import assert from 'node:assert/strict';
import { normalizeStringValue } from '../../packages/cli/src/commands/tasks/normalize-string-value-helper.ts';

// 8+ test cases
assert.equal(normalizeStringValue('hello'), 'hello');
assert.equal(normalizeStringValue('  hello  '), 'hello');
assert.equal(normalizeStringValue(''), null);
assert.equal(normalizeStringValue('   '), null);
assert.equal(normalizeStringValue(null), null);
assert.equal(normalizeStringValue(undefined), null);
assert.equal(normalizeStringValue(123), null);
assert.equal(normalizeStringValue(true), null);
assert.equal(normalizeStringValue({}), null);

console.log('[unit:normalize-string-value-helper] ok (9 assertions)');

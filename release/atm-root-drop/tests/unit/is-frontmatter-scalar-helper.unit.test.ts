/**
 * Unit tests for `packages/cli/src/commands/tasks/is-frontmatter-scalar-helper.ts`.
 */
import assert from 'node:assert/strict';
import { isFrontmatterScalar } from '../../packages/cli/src/commands/tasks/is-frontmatter-scalar-helper.ts';

// Test string
assert.equal(isFrontmatterScalar('hello'), true);
assert.equal(isFrontmatterScalar(''), true);

// Test number
assert.equal(isFrontmatterScalar(42), true);
assert.equal(isFrontmatterScalar(0), true);
assert.equal(isFrontmatterScalar(-1.5), true);

// Test boolean
assert.equal(isFrontmatterScalar(true), true);
assert.equal(isFrontmatterScalar(false), true);

// Test invalid types
assert.equal(isFrontmatterScalar(null), false);
assert.equal(isFrontmatterScalar(undefined), false);
assert.equal(isFrontmatterScalar({}), false);
assert.equal(isFrontmatterScalar([]), false);
assert.equal(isFrontmatterScalar(Symbol('symbol')), false);
assert.equal(isFrontmatterScalar(() => {}), false);

console.log('[unit:is-frontmatter-scalar-helper] ok (15+ assertions)');

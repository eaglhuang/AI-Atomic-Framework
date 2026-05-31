/**
 * Unit tests for `collectKeyValue` and `collectKeyValueFromLines` helpers.
 * Cluster: task-markdown-helpers (TASK-AAO-0100)
 */
import assert from 'node:assert/strict';
import { collectKeyValue, collectKeyValueFromLines, type HeadingSection } from '../../packages/cli/src/commands/tasks/task-markdown-helpers.ts';

// --- collectKeyValue tests ---

const sections: HeadingSection[] = [
  { heading: 'Metadata', lines: ['Status: done', '- Priority: high'] },
  { heading: 'Notes', lines: ['* author: alice', 'other-content'] }
];

// Test 1: finds a simple key
assert.equal(collectKeyValue(sections, 'Status'), 'done');

// Test 2: finds a key after bullet
assert.equal(collectKeyValue(sections, 'Priority'), 'high');

// Test 3: finds a key after asterisk bullet
assert.equal(collectKeyValue(sections, 'author'), 'alice');

// Test 4: case-insensitive key match
assert.equal(collectKeyValue(sections, 'status'), 'done');

// Test 5: returns null for missing key
assert.equal(collectKeyValue(sections, 'nonexistent-key'), null);

// Test 6: empty sections returns null
assert.equal(collectKeyValue([], 'Status'), null);

// --- collectKeyValueFromLines tests ---

const lines = ['Status: in-progress', '- Actor: bob', '* Label: my-label'];

// Test 7: finds key in lines
assert.equal(collectKeyValueFromLines(lines, 'Status'), 'in-progress');

// Test 8: finds after bullet dash
assert.equal(collectKeyValueFromLines(lines, 'Actor'), 'bob');

// Test 9: finds after asterisk
assert.equal(collectKeyValueFromLines(lines, 'Label'), 'my-label');

// Test 10: case-insensitive for lines
assert.equal(collectKeyValueFromLines(lines, 'actor'), 'bob');

// Test 11: returns null for missing key
assert.equal(collectKeyValueFromLines(lines, 'missing-key'), null);

// Test 12: empty lines returns null
assert.equal(collectKeyValueFromLines([], 'Status'), null);

console.log('[unit:collect-key-value-helper] ok (12 assertions)');

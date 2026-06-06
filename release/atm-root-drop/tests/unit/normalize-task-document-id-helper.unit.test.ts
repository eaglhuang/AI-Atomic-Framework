/**
 * Unit tests for `normalizeTaskDocumentId` helper.
 */
import assert from 'node:assert/strict';
import { normalizeTaskDocumentId } from '../../packages/cli/src/commands/tasks/normalize-task-document-id-helper.ts';

// 8+ test cases
assert.equal(normalizeTaskDocumentId({ workItemId: '123' }, 'fallback'), '123');
assert.equal(normalizeTaskDocumentId({ id: '456' }, 'fallback'), '456');
assert.equal(normalizeTaskDocumentId({ task_id: '789' }, 'fallback'), '789');
assert.equal(normalizeTaskDocumentId({ taskId: 'abc' }, 'fallback'), 'abc');
assert.equal(normalizeTaskDocumentId({ workItemId: '  123  ' }, 'fallback'), '123');
assert.equal(normalizeTaskDocumentId({ id: '' }, 'fallback'), 'fallback');
assert.equal(normalizeTaskDocumentId({}, 'fallback'), 'fallback');
assert.equal(normalizeTaskDocumentId({ other: 'xyz' }, 'my-fallback'), 'my-fallback');
assert.equal(normalizeTaskDocumentId({ id: null }, 'fallback'), 'fallback');

console.log('[unit:normalize-task-document-id-helper] ok (9 assertions)');

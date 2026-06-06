/**
 * Unit tests for `createTaskFromTableMetadata` helper.
 * Cluster: task-markdown-helpers (TASK-AAO-0100)
 */
import assert from 'node:assert/strict';
import { createTaskFromTableMetadata, type TaskTableMetadata } from '../../packages/cli/src/commands/tasks/task-markdown-helpers.ts';
import { createHash } from 'node:crypto';

// Simple hashSection stub for testing
function hashSection(text: string): string {
  return 'sha256:' + createHash('sha256').update(text).digest('hex');
}

const metadata: TaskTableMetadata = {
  workItemId: 'TASK-TEST-001',
  title: 'Test Task',
  status: 'planned',
  milestone: 'v1.0',
  dependencies: ['TASK-TEST-000'],
  deliverables: ['output.json'],
  rowText: 'Test task row text',
  headingLine: 42
};

// Test 1: returns correct schemaVersion
const result1 = createTaskFromTableMetadata({ metadata, planRelativePath: 'plans/test.md', importedAt: '2026-01-01T00:00:00Z', hashSection });
assert.equal(result1.schemaVersion, 'atm.workItem.v0.2');

// Test 2: workItemId is propagated
assert.equal(result1.workItemId, 'TASK-TEST-001');

// Test 3: title is propagated
assert.equal(result1.title, 'Test Task');

// Test 4: status is propagated
assert.equal(result1.status, 'planned');

// Test 5: milestone is propagated
assert.equal(result1.milestone, 'v1.0');

// Test 6: dependencies array is propagated
assert.deepEqual(result1.dependencies, ['TASK-TEST-000']);

// Test 7: deliverables array is propagated
assert.deepEqual(result1.deliverables, ['output.json']);

// Test 8: source.planPath is set
assert.equal(result1.source.planPath, 'plans/test.md');

// Test 9: source.headingLine is set
assert.equal(result1.source.headingLine, 42);

// Test 10: source.hash starts with sha256:
assert.ok(result1.source.hash.startsWith('sha256:'), 'hash should start with sha256:');

// Test 11: acceptance is empty array
assert.deepEqual(result1.acceptance, []);

// Test 12: tags is empty array
assert.deepEqual(result1.tags, []);

// Test 13: importedAt is propagated
assert.equal(result1.importedAt, '2026-01-01T00:00:00Z');

console.log('[unit:create-task-from-table-metadata-helper] ok (13 assertions)');

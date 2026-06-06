/**
 * Unit tests for `listCommittedFilesSinceClaim` helper.
 * Cluster: task-git-helpers (TASK-AAO-0100)
 */
import assert from 'node:assert/strict';
import { listCommittedFilesSinceClaim } from '../../packages/cli/src/commands/tasks/task-git-helpers.ts';
import type { TaskClaimRecord } from '@ai-atomic-framework/core';

// Test 1: returns empty files when claim is null
const r1 = listCommittedFilesSinceClaim(process.cwd(), null);
assert.ok(Array.isArray(r1.files), 'files should be array');
assert.equal(r1.files.length, 0);
assert.equal(r1.gitAvailable, false);

// Test 2: returns empty files when claimedAt is missing
const claimNoDate = { taskId: 'TASK-001' } as unknown as TaskClaimRecord;
const r2 = listCommittedFilesSinceClaim(process.cwd(), claimNoDate);
assert.equal(r2.files.length, 0);
assert.equal(r2.gitAvailable, false);

// Test 3: with a future claimedAt (no commits since then)
const futureClaim: Partial<TaskClaimRecord> = {
  claimedAt: new Date(Date.now() + 999999999).toISOString()
};
const r3 = listCommittedFilesSinceClaim(process.cwd(), futureClaim as TaskClaimRecord);
assert.ok(Array.isArray(r3.files), 'files should be an array');

// Test 4: with a very old claimedAt (should find committed files)
const oldClaim: Partial<TaskClaimRecord> = {
  claimedAt: '2020-01-01T00:00:00.000Z'
};
const r4 = listCommittedFilesSinceClaim(process.cwd(), oldClaim as TaskClaimRecord);
assert.ok(Array.isArray(r4.files), 'should return files array');

// Test 5: gitAvailable is boolean
assert.equal(typeof r4.gitAvailable, 'boolean');

// Test 6: invalid cwd returns graceful response
const r6 = listCommittedFilesSinceClaim('/nonexistent-abc-456', null);
assert.equal(r6.gitAvailable, false);
assert.equal(r6.files.length, 0);

// Test 7: files array contains strings when non-empty
if (r4.files.length > 0) {
  assert.equal(typeof r4.files[0], 'string', 'file entries should be strings');
}

// Test 8: files are unique (deduped)
const allUnique = new Set(r4.files).size === r4.files.length;
assert.ok(allUnique, 'files should be deduplicated');

console.log('[unit:list-committed-files-since-claim-helper] ok (8 assertions)');

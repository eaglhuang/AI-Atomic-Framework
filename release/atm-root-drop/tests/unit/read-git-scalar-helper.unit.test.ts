/**
 * Unit tests for `readGitScalar` helper.
 * Cluster: task-git-helpers (TASK-AAO-0100)
 */
import assert from 'node:assert/strict';
import { readGitScalar } from '../../packages/cli/src/commands/tasks/task-git-helpers.ts';

// Test 1: returns null for invalid cwd (git error)
const r1 = readGitScalar('/nonexistent-dir-abc-123', ['rev-parse', 'HEAD']);
assert.equal(r1, null, 'should return null for invalid git repo');

// Test 2: returns null for invalid args (bad git command)
const r2 = readGitScalar('/tmp', ['this-is-not-a-git-command']);
assert.equal(r2, null, 'should return null for invalid git args');

// Test 3: returns string or null type
const r3 = readGitScalar('/tmp', ['--version']);
assert.ok(r3 === null || typeof r3 === 'string', 'should return string or null');

// Test 4: valid git repo returns non-null for rev-parse
// Using current directory (AI-Atomic-Framework is a git repo)
const cwd = process.cwd();
const r4 = readGitScalar(cwd, ['rev-parse', 'HEAD']);
assert.ok(r4 !== null && r4.length > 0, 'should return commit hash for valid git repo');

// Test 5: trimmed output (no trailing newline)
const r5 = readGitScalar(cwd, ['rev-parse', 'HEAD']);
if (r5 !== null) {
  assert.ok(!r5.includes('\n'), 'output should be trimmed');
  assert.ok(!r5.includes('\r'), 'output should be trimmed');
}

// Test 6: branch name retrieval
const r6 = readGitScalar(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
assert.ok(r6 !== null, 'branch name should be readable');

// Test 7: function signature length check
assert.equal(readGitScalar.length, 2);

// Test 8: empty args array causes graceful null return
const r8 = readGitScalar('/nonexistent', []);
assert.equal(r8, null, 'empty args with invalid cwd should return null');

console.log('[unit:read-git-scalar-helper] ok (8 assertions)');

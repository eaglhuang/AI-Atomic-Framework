import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { inspectGitIndexLock, recoverGitIndexLock } from '../../packages/cli/src/commands/git-governance.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-index-lock-recovery-'));
execFileSync('git', ['init'], { cwd, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'ATM test'], { cwd, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'atm-test@example.invalid'], { cwd, stdio: 'ignore' });
writeFileSync(path.join(cwd, 'README.md'), 'fixture\n');
execFileSync('git', ['add', 'README.md'], { cwd, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd, stdio: 'ignore' });

const lockPath = path.join(cwd, '.git', 'index.lock');
mkdirSync(path.dirname(lockPath), { recursive: true });
writeFileSync(lockPath, 'synthetic stale index lock\n');

const inspection = inspectGitIndexLock(cwd);
assert.equal(inspection.exists, true);
assert.equal(inspection.lockPath, lockPath);
assert.equal(inspection.sizeBytes, Buffer.byteLength('synthetic stale index lock\n'));

assert.throws(
  () => recoverGitIndexLock({ cwd, force: false, dryRun: false }),
  (error: unknown) => (error as { code?: string }).code === 'ATM_GIT_INDEX_LOCK_PRESENT',
);
assert.equal(recoverGitIndexLock({ cwd, force: true, dryRun: true }).action, 'would-remove');
assert.equal(inspectGitIndexLock(cwd).exists, true);
assert.equal(recoverGitIndexLock({ cwd, force: true, dryRun: false }).action, 'removed');
assert.equal(inspectGitIndexLock(cwd).exists, false);
assert.equal(recoverGitIndexLock({ cwd, force: true, dryRun: false }).action, 'already-absent');

console.log('git-index-lock-recovery.test.ts passed');

import assert from 'node:assert/strict';
import {
  DEFAULT_GIT_BOUNDARY_TIMEOUT_MS,
  resolveGitBoundaryTimeoutMs,
  runGitCommandWithTimeout,
} from '../../packages/cli/src/commands/git-governance/implementation/git-process-port.ts';

assert.equal(resolveGitBoundaryTimeoutMs(null), DEFAULT_GIT_BOUNDARY_TIMEOUT_MS);
assert.equal(resolveGitBoundaryTimeoutMs(1234), 1234);
const previousExecutable = process.env.ATM_GIT_EXECUTABLE;
try {
  process.env.ATM_GIT_EXECUTABLE = process.execPath;
  assert.throws(
    () => runGitCommandWithTimeout(process.cwd(), ['-e', 'setTimeout(() => {}, 30_000)'], 250),
    (error: unknown) => (error as { code?: string }).code === 'ETIMEDOUT'
  );
} finally {
  if (previousExecutable === undefined) delete process.env.ATM_GIT_EXECUTABLE;
  else process.env.ATM_GIT_EXECUTABLE = previousExecutable;
}
console.log('[recover-push-fail-timeout] ok');

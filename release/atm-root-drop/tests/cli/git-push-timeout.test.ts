import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runGitCommandWithTimeout } from '../../packages/cli/src/commands/git-governance/implementation/git-process-port.ts';

// ATM-BUG-2026-08-14-009: a host Git control-plane child must not outlive
// the governed boundary indefinitely.  Use Node as a deterministic executable
// fixture so this tests the process boundary, not a network-dependent remote.
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-push-timeout-'));
const previousExecutable = process.env.ATM_GIT_EXECUTABLE;
try {
  process.env.ATM_GIT_EXECUTABLE = process.execPath;
  let timeoutError: unknown = null;
  const startedAt = Date.now();
  try {
    runGitCommandWithTimeout(repo, ['-e', 'setTimeout(() => {}, 30_000)'], 500);
  } catch (error) {
    timeoutError = error;
  }
  const elapsedMs = Date.now() - startedAt;
  assert.ok(timeoutError, 'a hung host command must be terminated');
  assert.equal((timeoutError as { code?: string }).code, 'ETIMEDOUT');
  assert.ok(elapsedMs < 10_000, `timeout must be bounded, elapsed=${elapsedMs}ms`);
  console.log('[git-push-timeout] process boundary timeout passed');
} finally {
  if (previousExecutable === undefined) delete process.env.ATM_GIT_EXECUTABLE;
  else process.env.ATM_GIT_EXECUTABLE = previousExecutable;
  rmSync(repo, { recursive: true, force: true });
}

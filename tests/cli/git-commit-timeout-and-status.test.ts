// ATM-BUG-2026-07-07-048 (OPT-08) regression test.
//
// `atm git commit` previously spawned the real `git commit` (and any
// pre-commit hook it runs) with no timeout at all, so a hung hook could wedge
// the governed commit lane forever with zero observable signal. There was
// also no way to idempotently ask "what happened to my last governed commit
// attempt?" after the fact. Confirm:
//   1. `--timeout-ms` bounds a hanging pre-commit hook and reports a
//      retryable `timeout` status instead of hanging forever.
//   2. `git commit-status` reports `committed` after a successful commit,
//      with a matching commit SHA.
//   3. `git commit-status` reports `not-found`-equivalent (null) for an
//      actor/task pair that never attempted a commit.
//
// Runnable directly via:
//   node --strip-types tests/cli/git-commit-timeout-and-status.test.ts

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../../packages/cli/src/commands/shared.ts';
import { runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readHeadSha(cwd: string): string {
  return runGit(cwd, ['rev-parse', 'HEAD']).trim();
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-commit-timeout-'));
const previousAtmGitName = process.env.ATM_GIT_NAME;
const previousAtmGitEmail = process.env.ATM_GIT_EMAIL;

try {
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.name', 'ATM Validator']);
  runGit(repo, ['config', 'user.email', 'validator@example.invalid']);
  runGit(repo, ['commit', '--allow-empty', '-m', 'bootstrap']);

  writeJson(path.join(repo, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });

  process.env.ATM_GIT_NAME = 'OPT-08 Actor';
  process.env.ATM_GIT_EMAIL = 'opt08-actor@example.invalid';

  // --- Scenario 1: commit-status for an actor that never attempted a commit.
  const neverAttemptedStatus = await runAtmGit(['commit-status', '--cwd', repo, '--actor', 'opt08-never-actor', '--json']);
  const neverAttemptedEvidence = (neverAttemptedStatus as { evidence?: Record<string, unknown> }).evidence;
  assert.equal(neverAttemptedEvidence?.commitAttemptStatus ?? null, null, 'expected no recorded commit attempt for a fresh actor/task pair');

  // --- Scenario 2: hung pre-commit hook is bounded by --timeout-ms.
  mkdirSync(path.join(repo, '.git/hooks'), { recursive: true });
  const hookPath = path.join(repo, '.git/hooks/pre-commit');
  writeFileSync(hookPath, '#!/bin/sh\nsleep 30\nexit 0\n', { mode: 0o755 });
  try { chmodSync(hookPath, 0o755); } catch { /* best-effort on platforms without POSIX perms */ }

  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src/hangs.ts'), 'export const value = 1;\n', 'utf8');

  let timeoutCaught: unknown = null;
  const timeoutStart = Date.now();
  try {
    await runAtmGit(['commit', '--cwd', repo, '--actor', 'opt08-actor', '--message', 'feat: should time out', '--auto-stage', '--timeout-ms', '1500', '--json']);
  } catch (error) {
    timeoutCaught = error;
  }
  const timeoutElapsedMs = Date.now() - timeoutStart;

  assert.ok(timeoutCaught instanceof CliError, `expected a CliError from the timed-out commit, got ${String(timeoutCaught)}`);
  assert.equal((timeoutCaught as CliError).code, 'ATM_GIT_COMMIT_FAILED', `unexpected error code: ${(timeoutCaught as CliError).code}`);
  assert.ok(timeoutElapsedMs < 25_000, `commit must abort near --timeout-ms (1500ms), not wait out the full 30s hook sleep; elapsed=${timeoutElapsedMs}ms`);

  const timeoutStatusResult = await runAtmGit(['commit-status', '--cwd', repo, '--actor', 'opt08-actor', '--json']);
  const timeoutStatusEvidence = (timeoutStatusResult as { evidence?: Record<string, unknown> }).evidence;
  const timeoutStatusRecord = timeoutStatusEvidence?.commitAttemptStatus as Record<string, unknown> | null | undefined;
  assert.ok(timeoutStatusRecord, 'expected a recorded commit attempt status after a timed-out commit');
  assert.equal(timeoutStatusRecord!.status, 'timeout', `expected status 'timeout', got ${JSON.stringify(timeoutStatusRecord)}`);

  // --- Scenario 3: successful commit reports `committed` with a matching SHA.
  writeFileSync(hookPath, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  try { chmodSync(hookPath, 0o755); } catch { /* best-effort on platforms without POSIX perms */ }

  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src/succeeds.ts'), 'export const value = 2;\n', 'utf8');

  await runAtmGit(['commit', '--cwd', repo, '--actor', 'opt08-actor', '--message', 'feat: should succeed', '--auto-stage', '--json']);
  const committedSha = readHeadSha(repo);

  const okStatusResult = await runAtmGit(['commit-status', '--cwd', repo, '--actor', 'opt08-actor', '--json']);
  const okStatusEvidence = (okStatusResult as { evidence?: Record<string, unknown> }).evidence;
  const okStatusRecord = okStatusEvidence?.commitAttemptStatus as Record<string, unknown> | null | undefined;
  assert.ok(okStatusRecord, 'expected a recorded commit attempt status after a successful commit');
  assert.equal(okStatusRecord!.status, 'committed', `expected status 'committed', got ${JSON.stringify(okStatusRecord)}`);
  assert.equal(okStatusRecord!.commitSha, committedSha, 'commit-status must report the actual committed SHA');

  console.log('[git-commit-timeout-and-status:test] ok');
} finally {
  if (previousAtmGitName === undefined) delete process.env.ATM_GIT_NAME; else process.env.ATM_GIT_NAME = previousAtmGitName;
  if (previousAtmGitEmail === undefined) delete process.env.ATM_GIT_EMAIL; else process.env.ATM_GIT_EMAIL = previousAtmGitEmail;
}

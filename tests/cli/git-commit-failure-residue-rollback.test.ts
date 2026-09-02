// ATM-BUG-2026-07-07-047 (OPT-07) regression test.
//
// `atm git commit --auto-stage` may stage claim-scoped source and provenance
// paths directly onto the LIVE index before attempting the real `git commit`.
// If that commit ultimately fails (e.g. a signing misconfiguration rejects
// it), nothing newly staged for that attempt may remain in the live index.
// Confirm the wrapper restores exactly the caller's pre-attempt staged state;
// raw-git commit failures on unrelated repos are outside ATM's control and
// stay untouched.
//
// Runnable directly via:
//   node --strip-types tests/cli/git-commit-failure-residue-rollback.test.ts

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../../packages/cli/src/commands/shared.ts';
import { runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';
import { runFrameworkTempClaim } from '../../packages/cli/src/commands/framework-development/closure-packet-schema/implementation.ts';

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readStagedFiles(cwd: string): string[] {
  return runGit(cwd, ['diff', '--cached', '--name-only']).trim().split(/\r?\n/).filter(Boolean).sort();
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-commit-residue-'));
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

  process.env.ATM_GIT_NAME = 'OPT-07 Actor';
  process.env.ATM_GIT_EMAIL = 'opt07-actor@example.invalid';

  writeFileSync(path.join(repo, 'notes.txt'), 'unrelated pre-staged work\n', 'utf8');
  runGit(repo, ['add', 'notes.txt']);
  const stagedBeforeAttempt = readStagedFiles(repo);
  assert.deepEqual(stagedBeforeAttempt, ['notes.txt'], 'fixture must start with exactly one caller-staged file');

  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src/app.ts'), 'export const value = 1;\n', 'utf8');

  // The framework commit facade requires a scoped temporary claim before it
  // can reach the underlying signing failure. Establish the normal
  // prerequisite so this fixture continues to test rollback, not admission.
  const claim = await runFrameworkTempClaim(
    repo,
    'opt07-actor',
    ['src/app.ts'],
    'exercise governed commit failure residue rollback regression'
  );
  assert.equal(claim.ok, true, 'fixture claim must admit the governed commit path');

  // Force the underlying `git commit` invocation to fail deterministically and
  // portably (no hook/shebang platform dependence): request GPG signing but
  // point at a nonexistent signing program.
  runGit(repo, ['config', 'commit.gpgsign', 'true']);
  runGit(repo, ['config', 'gpg.program', 'atm-nonexistent-gpg-binary-for-test']);

  let caught: unknown = null;
  try {
    await runAtmGit(['commit', '--cwd', repo, '--actor', 'opt07-actor', '--message', 'feat: should fail to sign', '--auto-stage', '--defer-foreign-staged', '--json']);
  } catch (error) {
    caught = error;
  }

  assert.ok(caught instanceof CliError, `expected a CliError from the failed commit, got ${String(caught)}`);
  const cliError = caught as CliError;
  assert.equal(cliError.code, 'ATM_GIT_COMMIT_FAILED', `unexpected error code: ${cliError.code}`);

  const details = cliError.details as Record<string, unknown> | undefined;
  assert.equal(details?.headAdvancedDuringAttempt, false, 'failed signing attempt must report that HEAD did not advance');
  assert.match(String(details?.statusCommand), /git commit-status --actor "?opt07-actor"? --json/, 'failed commit details must include a status command');
  assert.match(String(details?.retryCommand), /git commit --actor "?opt07-actor"? --message/, 'failed commit details must include a retry command');
  assert.match(String(details?.recoveryGuidance), /HEAD did not advance/, 'failed commit details must explain whether retry is safe');

  const statusResult = await runAtmGit(['commit-status', '--cwd', repo, '--actor', 'opt07-actor', '--json']);
  const statusEvidence = (statusResult as { evidence?: Record<string, unknown> }).evidence;
  const statusRecord = statusEvidence?.commitAttemptStatus as Record<string, unknown> | null | undefined;
  assert.ok(statusRecord, 'failed commit must leave an inspectable commit-status record');
  assert.equal(statusRecord!.status, 'failed', `expected failed status, got ${JSON.stringify(statusRecord)}`);
  assert.equal(statusRecord!.headAdvancedDuringAttempt, false, 'failed status must record that HEAD did not advance');

  const liveIndexResidueRollback = Array.isArray(details?.liveIndexResidueRollback)
    ? details!.liveIndexResidueRollback as string[]
    : [];
  assert.ok(
    liveIndexResidueRollback.includes('src/app.ts'),
    `expected the failed commit to report rolling back its auto-staged claim path, got ${JSON.stringify(liveIndexResidueRollback)}`
  );

  const stagedAfterFailure = readStagedFiles(repo);
  assert.deepEqual(
    stagedAfterFailure,
    stagedBeforeAttempt,
    `live index must return to its pre-attempt state after a failed governed commit; before=${JSON.stringify(stagedBeforeAttempt)} after=${JSON.stringify(stagedAfterFailure)}`
  );

  console.log('[git-commit-failure-residue-rollback:test] ok');
} finally {
  if (previousAtmGitName === undefined) delete process.env.ATM_GIT_NAME; else process.env.ATM_GIT_NAME = previousAtmGitName;
  if (previousAtmGitEmail === undefined) delete process.env.ATM_GIT_EMAIL; else process.env.ATM_GIT_EMAIL = previousAtmGitEmail;
}

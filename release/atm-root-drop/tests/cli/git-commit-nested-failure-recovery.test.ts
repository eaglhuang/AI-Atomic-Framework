// ATM-GOV-0260: nested commit-failure recovery surface.
//
// When governed `atm git commit` fails, the wrapper must expose the nested
// root cause from the commit-attempt record in the top-level CliError details
// (exact nested code/summary, attempt path, and a smallest safe next action),
// and `git commit-status` must accept the same actor/task context.
//
// Runnable directly via:
//   node --strip-types tests/cli/git-commit-nested-failure-recovery.test.ts

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliError } from '../../packages/cli/src/commands/shared.ts';
import { runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-commit-nested-'));
const previousAtmGitName = process.env.ATM_GIT_NAME;
const previousAtmGitEmail = process.env.ATM_GIT_EMAIL;
const actorId = 'nested-failure-actor';
const taskId = 'ATM-GOV-0260-NESTED';
const sessionId = 'session-nested-failure-actor';

try {
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.name', 'ATM Validator']);
  runGit(repo, ['config', 'user.email', 'validator@example.invalid']);
  runGit(repo, ['commit', '--allow-empty', '-m', 'bootstrap']);

  writeJson(path.join(repo, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: {
      tasks: '.atm/history/tasks',
      taskEvents: '.atm/history/task-events',
    },
    taskLedger: {
      enabled: true,
      mode: 'auto',
      mirrorExternalTasks: true,
      requireCliTransitions: true,
      provider: 'atm-local',
    },
  });

  writeJson(path.join(repo, `.atm/history/tasks/${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Nested failure recovery fixture',
    status: 'running',
    deliverables: ['packages/cli/src/oversized.ts'],
    scopePaths: ['packages/cli/src/oversized.ts'],
    validators: [],
  });
  writeJson(path.join(repo, `.atm/runtime/sessions/${sessionId}.json`), {
    schemaId: 'atm.actorWorkSession.v1',
    specVersion: '0.1.0',
    sessionId,
    actorId,
    taskId,
    claimLeaseId: 'lease-nested-failure',
    status: 'active',
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  });

  process.env.ATM_GIT_NAME = 'Nested Failure Actor';
  process.env.ATM_GIT_EMAIL = 'nested-failure-actor@example.invalid';

  // Scenario A: oversized staged candidate must fail closed with the exact
  // line-budget nested code surfaced through ATM_GIT_COMMIT_FAILED details.
  const oversized = Array.from(
    { length: 650 },
    (_, index) => `export const line${index} = ${index};`,
  ).join('\n') + '\n';
  mkdirSync(path.join(repo, 'packages/cli/src'), { recursive: true });
  writeFileSync(path.join(repo, 'packages/cli/src/oversized.ts'), oversized, 'utf8');
  runGit(repo, ['add', 'packages/cli/src/oversized.ts']);

  let oversizedCaught: unknown = null;
  try {
    await runAtmGit([
      'commit',
      '--cwd',
      repo,
      '--actor',
      actorId,
      '--task',
      taskId,
      '--session',
      sessionId,
      '--message',
      'feat: oversized staged candidate',
      '--json',
    ]);
  } catch (error) {
    oversizedCaught = error;
  }

  assert.ok(
    oversizedCaught instanceof CliError,
    `expected CliError for oversized candidate, got ${String(oversizedCaught)}`,
  );
  const oversizedError = oversizedCaught as CliError;
  assert.equal(
    oversizedError.code,
    'ATM_GIT_COMMIT_FAILED',
    `oversized candidate must wrap as ATM_GIT_COMMIT_FAILED, got ${oversizedError.code}`,
  );

  const oversizedDetails = (oversizedError.details ?? {}) as Record<string, unknown>;
  const nestedFailure = oversizedDetails.nestedFailure as Record<string, unknown> | null;
  assert.ok(nestedFailure && typeof nestedFailure === 'object', 'ATM_GIT_COMMIT_FAILED must include nestedFailure');
  assert.equal(
    nestedFailure.errorCode,
    'ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED',
    `nested errorCode must be ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED, got ${String(nestedFailure.errorCode)}`,
  );
  assert.ok(
    typeof nestedFailure.errorSummary === 'string' && nestedFailure.errorSummary.length > 0,
    'nestedFailure.errorSummary must be present',
  );
  assert.ok(
    typeof oversizedDetails.commitAttemptStatusPath === 'string' &&
      String(oversizedDetails.commitAttemptStatusPath).includes('.atm/runtime/git-commit-attempts/'),
    `commitAttemptStatusPath must point at the attempt record, got ${String(oversizedDetails.commitAttemptStatusPath)}`,
  );
  assert.match(
    String(oversizedDetails.recoveryGuidance ?? ''),
    /ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED|nested failure/i,
    'recoveryGuidance must name the nested failure instead of blind retry',
  );
  assert.ok(
    typeof oversizedDetails.statusCommand === 'string' &&
      String(oversizedDetails.statusCommand).includes('commit-status'),
    'details must include a commit-status next action',
  );

  // Scenario B: commit-status must accept the same actor/task context.
  const statusResult = await runAtmGit([
    'commit-status',
    '--cwd',
    repo,
    '--actor',
    actorId,
    '--task',
    taskId,
    '--session',
    sessionId,
    '--json',
  ]);
  const statusEvidence = (statusResult as { evidence?: Record<string, unknown> }).evidence;
  const statusRecord = statusEvidence?.commitAttemptStatus as Record<string, unknown> | null | undefined;
  assert.ok(statusRecord, 'commit-status must report the latest failed attempt for actor/task');
  assert.equal(statusRecord!.status, 'failed', `expected failed status, got ${JSON.stringify(statusRecord)}`);
  assert.equal(
    statusRecord!.errorCode,
    'ATM_TOUCHED_PHYSICAL_LINE_BUDGET_BLOCKED',
    `commit-status must echo nested errorCode, got ${String(statusRecord!.errorCode)}`,
  );

  console.log('[git-commit-nested-failure-recovery.test] ok');
} finally {
  if (previousAtmGitName === undefined) delete process.env.ATM_GIT_NAME;
  else process.env.ATM_GIT_NAME = previousAtmGitName;
  if (previousAtmGitEmail === undefined) delete process.env.ATM_GIT_EMAIL;
  else process.env.ATM_GIT_EMAIL = previousAtmGitEmail;
}

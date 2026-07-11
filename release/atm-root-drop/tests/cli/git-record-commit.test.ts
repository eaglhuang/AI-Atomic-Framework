// Regression coverage for ATM-BUG-2026-07-08-058.
//
// `git record-commit` is the official narrow lane for low-risk .atm/history
// record maintenance. It must not become a broad bypass for source changes or
// high-risk closure/repair/protected-override boundaries.

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
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

async function expectRecordCommitBlocked(repo: string, expectedCode: string) {
  let caught: unknown = null;
  try {
    await runAtmGit([
      'record-commit',
      '--cwd',
      repo,
      '--actor',
      'record-actor',
      '--message',
      'atm: blocked record commit',
      '--dry-run',
      '--json'
    ]);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof CliError, `expected ${expectedCode}, got ${String(caught)}`);
  assert.equal((caught as CliError).code, expectedCode);
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-record-commit-'));
const previousAtmGitName = process.env.ATM_GIT_NAME;
const previousAtmGitEmail = process.env.ATM_GIT_EMAIL;

try {
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.name', 'ATM Validator']);
  runGit(repo, ['config', 'user.email', 'validator@example.invalid']);
  runGit(repo, ['commit', '--allow-empty', '-m', 'bootstrap']);

  process.env.ATM_GIT_NAME = 'Record Actor';
  process.env.ATM_GIT_EMAIL = 'record-actor@example.invalid';

  writeJson(path.join(repo, '.atm/history/tasks/TASK-RECORD-0001.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-RECORD-0001',
    status: 'open',
    title: 'Record lane fixture'
  });
  runGit(repo, ['add', '.atm/history/tasks/TASK-RECORD-0001.json']);

  const dryRun = await runAtmGit([
    'record-commit',
    '--cwd',
    repo,
    '--actor',
    'record-actor',
    '--message',
    'atm: sync record fixture',
    '--dry-run',
    '--json'
  ]);
  assert.equal(dryRun.ok, true);
  assert.equal((dryRun.evidence as Record<string, unknown>).action, 'record-commit');

  const commitResult = await runAtmGit([
    'record-commit',
    '--cwd',
    repo,
    '--actor',
    'record-actor',
    '--message',
    'atm: sync record fixture',
    '--json'
  ]);
  assert.equal(commitResult.ok, true);
  assert.equal((commitResult.evidence as Record<string, unknown>).action, 'record-commit');

  const log = runGit(repo, ['log', '-1', '--format=%B']);
  assert.match(log, /ATM-Actor: record-actor/);
  assert.match(log, /ATM-Record-Commit: true/);
  const committedFiles = runGit(repo, ['show', '--name-only', '--format=', 'HEAD']);
  assert.match(committedFiles, /\.atm\/history\/tasks\/TASK-RECORD-0001\.json/);
  assert.match(committedFiles, /\.atm\/history\/evidence\/git-head\.jsonl/);

  writeJson(path.join(repo, '.atm/history/tasks/TASK-RECORD-0001.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-RECORD-0001',
    status: 'done',
    title: 'Record lane fixture'
  });
  writeJson(path.join(repo, '.atm/history/tasks/TASK-RECORD-0002.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-RECORD-0002',
    status: 'done',
    title: 'Second record lane fixture'
  });
  runGit(repo, ['add', '.atm/history/tasks/TASK-RECORD-0001.json', '.atm/history/tasks/TASK-RECORD-0002.json']);
  await expectRecordCommitBlocked(repo, 'ATM_CROSS_TASK_MUTATION_BLOCKED');
  runGit(repo, ['restore', '--staged', '.atm/history/tasks/TASK-RECORD-0001.json', '.atm/history/tasks/TASK-RECORD-0002.json']);
  runGit(repo, ['restore', '.atm/history/tasks/TASK-RECORD-0001.json']);
  runGit(repo, ['clean', '-f', '--', '.atm/history/tasks/TASK-RECORD-0002.json']);

  writeFileSync(path.join(repo, 'src.ts'), 'export const source = true;\n', 'utf8');
  runGit(repo, ['add', 'src.ts']);
  await expectRecordCommitBlocked(repo, 'ATM_GIT_RECORD_COMMIT_SCOPE_VIOLATION');
  runGit(repo, ['restore', '--staged', 'src.ts']);

  writeJson(path.join(repo, '.atm/history/evidence/TASK-RECORD-0001.closure-packet.json'), {
    taskId: 'TASK-RECORD-0001',
    targetCommit: 'deadbeef'
  });
  runGit(repo, ['add', '.atm/history/evidence/TASK-RECORD-0001.closure-packet.json']);
  await expectRecordCommitBlocked(repo, 'ATM_GIT_RECORD_COMMIT_SCOPE_VIOLATION');

  console.log('[git-record-commit:test] ok');
} finally {
  if (previousAtmGitName === undefined) delete process.env.ATM_GIT_NAME; else process.env.ATM_GIT_NAME = previousAtmGitName;
  if (previousAtmGitEmail === undefined) delete process.env.ATM_GIT_EMAIL; else process.env.ATM_GIT_EMAIL = previousAtmGitEmail;
}

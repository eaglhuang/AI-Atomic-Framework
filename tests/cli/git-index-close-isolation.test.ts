import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildGitIndexLeaseParkPlan,
  inspectGitIndexOwnership,
  parkGitIndexLease,
  restoreGitIndexLease
} from '../../packages/cli/src/commands/git-index-ownership.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-index-close-isolation-'));

function git(args: readonly string[]): string {
  return execFileSync('git', [...args], {
    cwd: repo,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function write(filePath: string, content: string): void {
  const absolute = path.join(repo, filePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, 'utf8');
}

function stagedBlob(filePath: string): string {
  const line = git(['ls-files', '-s', '--', filePath]).trim();
  const match = line.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t(.+)$/i);
  assert.ok(match, `expected staged blob for ${filePath}`);
  return `${match[1]}:${match[2]}:${match[3]}`;
}

try {
  git(['init']);
  git(['config', 'user.name', 'fixture-agent']);
  git(['config', 'user.email', 'fixture-agent@example.com']);

  const taskId = 'ATM-GOV-0128';
  const foreignTaskId = 'TASK-FOREIGN-0001';
  const activeForeignTaskId = 'TASK-FOREIGN-ACTIVE-0002';
  const currentCloseFile = `.atm/history/tasks/${taskId}.json`;
  const foreignFile = 'src/foreign-owned.ts';
  const activeForeignFile = 'src/foreign-active.ts';

  write(currentCloseFile, `${JSON.stringify({ workItemId: taskId, status: 'running' })}\n`);
  write(foreignFile, 'export const foreign = "base";\n');
  write(activeForeignFile, 'export const activeForeign = "base";\n');
  git(['add', '.']);
  git(['commit', '-m', 'chore: seed close isolation fixture']);

  write(currentCloseFile, `${JSON.stringify({ workItemId: taskId, status: 'done' })}\n`);
  write(foreignFile, 'export const foreign = "approved-partial-stage";\n');
  git(['add', currentCloseFile, foreignFile]);
  const foreignApprovedBlob = stagedBlob(foreignFile);
  write(foreignFile, 'export const foreign = "worktree-continues-after-stage";\n');

  const dryRunReport = inspectGitIndexOwnership({ cwd: repo, taskId });
  const realHookReport = inspectGitIndexOwnership({ cwd: repo, taskId, stagedFiles: git(['diff', '--cached', '--name-only']).split(/\r?\n/).filter(Boolean) });
  assert.deepEqual(
    realHookReport.entries.map((entry) => [entry.path, entry.ownership, entry.stagedBlobId]),
    dryRunReport.entries.map((entry) => [entry.path, entry.ownership, entry.stagedBlobId]),
    'dry-run and real hook classification must agree for the same staged index'
  );

  const plan = buildGitIndexLeaseParkPlan({
    report: dryRunReport,
    expectedStageFiles: [currentCloseFile],
    leaseId: 'close-index-fixture'
  });
  assert.equal(plan.status, 'park-and-restore');
  assert.deepEqual(plan.parkEntries.map((entry) => entry.path), [foreignFile]);
  assert.deepEqual(plan.restoreEntries.map((entry) => entry.restoreIdentity), [`${foreignApprovedBlob}`]);
  assert.deepEqual(plan.approvedPartialStagedBlobIds, [foreignApprovedBlob.split(':')[1]]);

  assert.deepEqual(parkGitIndexLease(repo, plan), [foreignFile]);
  assert.equal(git(['diff', '--cached', '--name-only']).includes(foreignFile), false, 'foreign staged file must be parked from the live index');
  assert.equal(readFileSync(path.join(repo, foreignFile), 'utf8'), 'export const foreign = "worktree-continues-after-stage";\n');

  assert.deepEqual(restoreGitIndexLease(repo, plan), [foreignFile]);
  assert.equal(stagedBlob(foreignFile), foreignApprovedBlob, 'approved partial-staged blob must restore byte-identically');
  assert.equal(readFileSync(path.join(repo, foreignFile), 'utf8'), 'export const foreign = "worktree-continues-after-stage";\n');

  write(`.atm/history/tasks/${activeForeignTaskId}.json`, `${JSON.stringify({
    workItemId: activeForeignTaskId,
    status: 'running'
  })}\n`);
  write(`.atm/runtime/locks/${activeForeignTaskId}.lock.json`, `${JSON.stringify({
    schemaId: 'atm.governanceScopeLock',
    workItemId: activeForeignTaskId,
    actorId: 'other-captain',
    lockedBy: 'other-captain',
    status: 'active',
    files: [activeForeignFile],
    taskDirectionLock: {
      schemaId: 'atm.taskDirectionLock.v1',
      taskId: activeForeignTaskId,
      actorId: 'other-captain',
      status: 'active',
      allowedFiles: [activeForeignFile]
    }
  })}\n`);
  write(activeForeignFile, 'export const activeForeign = "staged";\n');
  git(['add', activeForeignFile]);
  const blockedReport = inspectGitIndexOwnership({ cwd: repo, taskId });
  const blockedPlan = buildGitIndexLeaseParkPlan({
    report: blockedReport,
    expectedStageFiles: [currentCloseFile],
    leaseId: 'close-index-blocked-fixture'
  });
  assert.equal(blockedPlan.status, 'blocked-foreign-active-staged');
  assert.equal(blockedPlan.restoreEntries.some((entry) => entry.path === activeForeignFile), true);

  console.log('[git-index-close-isolation] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

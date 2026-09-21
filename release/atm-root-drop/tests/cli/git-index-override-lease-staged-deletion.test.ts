import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  authorizeGitIndexOverrideLease,
  inspectGitIndexOwnership,
  parkGitIndexLease,
  restoreGitIndexLease
} from '../../packages/cli/src/commands/git-index-ownership.ts';
import { runGitLease } from '../../packages/cli/src/commands/git-governance/implementation/lease-command.ts';

const tempDir = path.join(os.tmpdir(), `atm-index-deletion-${process.pid}`);
const runGit = (args: string[]) => execFileSync('git', args, {
  cwd: tempDir,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe']
});

try {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(path.join(tempDir, 'src'), { recursive: true });
  runGit(['init']);
  runGit(['config', 'user.name', 'fixture-agent']);
  runGit(['config', 'user.email', 'fixture-agent@example.invalid']);

  const foreignTaskId = 'TASK-FOREIGN-DELETE-0001';
  const presentPath = 'src/foreign-present.ts';
  const deletedPath = 'src/foreign-deleted.ts';
  writeFileSync(path.join(tempDir, deletedPath), 'export const deleteMe = true;\n', 'utf8');
  runGit(['add', deletedPath]);
  runGit(['commit', '-m', 'fixture base']);
  writeFileSync(path.join(tempDir, presentPath), 'export const present = true;\n', 'utf8');
  rmSync(path.join(tempDir, deletedPath));

  mkdirSync(path.join(tempDir, '.atm/runtime/task-direction-locks'), { recursive: true });
  mkdirSync(path.join(tempDir, '.atm/history/tasks'), { recursive: true });
  writeFileSync(path.join(tempDir, '.atm/history/tasks', `${foreignTaskId}.json`), `${JSON.stringify({
    workItemId: foreignTaskId,
    status: 'running',
    claim: {
      actorId: 'foreign-agent',
      leaseId: 'lease-foreign-delete',
      claimedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
      ttlSeconds: 3600,
      files: [presentPath, deletedPath],
      state: 'active'
    }
  }, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(tempDir, '.atm/runtime/task-direction-locks', `${foreignTaskId}.json`), `${JSON.stringify({
    schemaId: 'atm.taskDirectionLock.v1',
    specVersion: '0.1.0',
    taskId: foreignTaskId,
    allowedFiles: [presentPath, deletedPath],
    planningReadOnlyPaths: [],
    planningMirrorPaths: [],
    allowPlanningMirror: false,
    actorId: 'foreign-agent',
    sessionId: 'session-foreign-delete',
    createdAt: new Date().toISOString(),
    status: 'active'
  }, null, 2)}\n`, 'utf8');
  runGit(['add', '-A', '--', presentPath, deletedPath]);

  const ownership = inspectGitIndexOwnership({ cwd: tempDir, taskId: 'TASK-CLOSE-DELETE-0001' });
  assert.deepEqual(ownership.foreignActiveStaged.map((entry) => entry.path), [deletedPath, presentPath]);
  const deletion = ownership.foreignActiveStaged.find((entry) => entry.path === deletedPath);
  assert.deepEqual(
    { state: deletion?.stagedState, blob: deletion?.stagedBlobId, mode: deletion?.stagedMode },
    { state: 'deleted', blob: null, mode: null }
  );

  const issued = runGitLease({
    cwd: tempDir,
    actorId: 'fixture-agent',
    taskId: 'TASK-CLOSE-DELETE-0001',
    leaseKind: 'stage-override',
    paths: [deletedPath, presentPath],
    overrideReason: 'fixture human approval',
    ttlSeconds: 60
  });
  const lease = (issued.evidence as {
    lease: { leaseId: string; stagedEntries: Array<{ path: string; stagedState: string }> };
  }).lease;
  assert.equal(lease.stagedEntries.find((entry) => entry.path === deletedPath)?.stagedState, 'deleted');

  const authorized = authorizeGitIndexOverrideLease({
    cwd: tempDir,
    leaseId: lease.leaseId,
    actorId: 'fixture-agent',
    taskId: 'TASK-CLOSE-DELETE-0001',
    report: ownership
  });
  if (!authorized.ok) throw new Error(authorized.summary);
  assert.equal(authorized.ok, true, 'a staged deletion must be a content-bound tombstone, not index drift');

  assert.deepEqual(parkGitIndexLease(tempDir, authorized.plan), [deletedPath, presentPath]);
  assert.equal(runGit(['diff', '--cached', '--name-only']).trim(), '');
  assert.deepEqual(restoreGitIndexLease(tempDir, authorized.plan), [deletedPath, presentPath]);
  assert.deepEqual(runGit(['diff', '--cached', '--name-only']).trim().split(/\r?\n/), [deletedPath, presentPath]);
  assert.equal(runGit(['diff', '--cached', '--diff-filter=D', '--name-only']).trim(), deletedPath);
  assert.equal(runGit(['ls-files', '-s', '--', deletedPath]).trim(), '');

  console.log(JSON.stringify({ marker: '[git-index-override-lease-staged-deletion] ok' }));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

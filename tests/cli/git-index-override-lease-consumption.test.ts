import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  authorizeGitIndexOverrideLease,
  consumeGitIndexOverrideLease,
  type GitIndexOwnershipReport,
  parkGitIndexLease,
  restoreGitIndexLease
} from '../../packages/cli/src/commands/git-index-ownership.ts';
const tempDir = path.join(os.tmpdir(), `atm-index-lease-${process.pid}`);
const runGit = (args: string[]) => execFileSync('git', args, { cwd: tempDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
try {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });
  runGit(['init']);
  runGit(['config', 'user.name', 'fixture-agent']);
  runGit(['config', 'user.email', 'fixture-agent@example.invalid']);
  writeFileSync(path.join(tempDir, 'README.md'), 'fixture\n', 'utf8');
  runGit(['add', 'README.md']);
  runGit(['commit', '-m', 'fixture']);
  const taskId = 'TASK-GIT-LEASE-0001';
  const foreignPath = 'src/foreign-index-entry.ts';
  mkdirSync(path.join(tempDir, 'src'), { recursive: true });
  writeFileSync(path.join(tempDir, foreignPath), 'export const foreignIndexEntry = true;\n', 'utf8');
  runGit(['add', foreignPath]);
  const entry = { path: foreignPath, ownership: 'foreign-active-owned' as const, ownerTaskId: 'TASK-FOREIGN-0001', ownerActorId: 'other-agent', ownerSessionId: 'session-foreign', stagedBlobId: runGit(['rev-parse', `:${foreignPath}`]).trim(), stagedMode: '100644', source: 'active-direction-lock' as const };
  const report: GitIndexOwnershipReport = {
    schemaId: 'atm.gitIndexOwnership.v1', taskId, generatedAt: new Date().toISOString(), entries: [entry], foreignActiveStaged: [entry],
    indexLane: { schemaId: 'atm.gitIndexLane.v1', status: 'blocked-foreign-active-staged', ownerTaskId: entry.ownerTaskId, ownerActorId: entry.ownerActorId, ownerSessionId: entry.ownerSessionId, reason: 'fixture' }
  };
  const leaseId = 'git-stage-override-fixture';
  const leasePath = path.join(tempDir, '.atm/runtime/git-index-leases', `${leaseId}.json`);
  mkdirSync(path.dirname(leasePath), { recursive: true });
  writeFileSync(leasePath, `${JSON.stringify({
    schemaId: 'atm.gitIndexOverrideLease.v1',
    leaseId,
    kind: 'stage-override',
    permission: 'git.index.stageOverride',
    actorId: 'fixture-agent',
    taskId,
    paths: [foreignPath],
    stagedEntries: [{ path: foreignPath, stagedBlobId: entry.stagedBlobId, stagedMode: entry.stagedMode }],
    singleUse: true,
    used: false,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  }, null, 2)}\n`, 'utf8');

  const authorized = authorizeGitIndexOverrideLease({ cwd: tempDir, leaseId, actorId: 'fixture-agent', taskId, report });
  assert.equal(authorized.ok, true);
  if (!authorized.ok) throw new Error('expected fixture lease authorization');
  const parked = parkGitIndexLease(tempDir, authorized.plan);
  assert.deepEqual(parked, [foreignPath]);
  assert.equal(runGit(['diff', '--cached', '--name-only']).includes(foreignPath), false);
  const restored = restoreGitIndexLease(tempDir, authorized.plan);
  assert.deepEqual(restored, [foreignPath]);
  assert.equal(runGit(['rev-parse', `:${foreignPath}`]).trim(), entry.stagedBlobId);

  consumeGitIndexOverrideLease(tempDir, authorized.lease);
  const used = authorizeGitIndexOverrideLease({ cwd: tempDir, leaseId, actorId: 'fixture-agent', taskId, report });
  assert.equal(used.ok, false);
  assert.equal(used.code, 'ATM_GIT_INDEX_OVERRIDE_LEASE_ALREADY_USED');

  const drifted = JSON.parse(readFileSync(leasePath, 'utf8'));
  drifted.used = false;
  drifted.stagedEntries[0].stagedBlobId = '0'.repeat(40);
  writeFileSync(leasePath, `${JSON.stringify(drifted, null, 2)}\n`, 'utf8');
  const drift = authorizeGitIndexOverrideLease({ cwd: tempDir, leaseId, actorId: 'fixture-agent', taskId, report });
  assert.equal(drift.ok, false);
  assert.equal(drift.code, 'ATM_GIT_INDEX_OVERRIDE_LEASE_INDEX_DRIFT');

  const releasedEntry = { ...entry, ownership: 'foreign-released-or-abandoned' as const, ownerActorId: null, ownerSessionId: null };
  const releasedReport: GitIndexOwnershipReport = {
    ...report,
    entries: [releasedEntry],
    foreignActiveStaged: []
  };
  drifted.stagedEntries[0].stagedBlobId = releasedEntry.stagedBlobId;
  writeFileSync(leasePath, `${JSON.stringify(drifted, null, 2)}\n`, 'utf8');
  const released = authorizeGitIndexOverrideLease({ cwd: tempDir, leaseId, actorId: 'fixture-agent', taskId, report: releasedReport });
  assert.equal(released.ok, true);
  if (!released.ok) throw new Error('expected released foreign bundle authorization');
  assert.equal(released.plan.status, 'park-and-restore');
  console.log(JSON.stringify({
    marker: '[git-index-override-lease-consumption] ok'
  }));
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

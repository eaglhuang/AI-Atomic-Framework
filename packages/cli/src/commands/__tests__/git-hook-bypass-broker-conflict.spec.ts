import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runAtmGit } from '../git-governance.ts';
import { createEmergencyLease } from '../emergency/leases.ts';
import { CliError } from '../shared.ts';

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-git-hook-bypass-broker-'));

try {
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.name', 'Fixture Agent']);
  runGit(repo, ['config', 'user.email', 'fixture@example.com']);

  const taskId = 'TASK-BROKER-CONFLICT';
  const taskPath = path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`);
  mkdirSync(path.dirname(taskPath), { recursive: true });
  writeFileSync(taskPath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Broker conflict fixture',
    status: 'running',
    owner: 'broker-owner',
    scopePaths: ['src/broker-owned.ts'],
    deliverables: ['src/broker-owned.ts'],
    claim: {
      state: 'active',
      actorId: 'broker-owner',
      leaseId: 'lease-broker-conflict',
      files: ['src/broker-owned.ts'],
      heartbeatAt: new Date().toISOString(),
      ttlSeconds: 1800
    }
  }, null, 2)}\n`, 'utf8');

  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'broker-owned.ts'), 'export const brokerOwned = true;\n', 'utf8');
  runGit(repo, ['add', 'src/broker-owned.ts']);

  const { lease } = createEmergencyLease({
    cwd: repo,
    taskId: null,
    actorId: 'fixture-agent',
    permission: 'backend.gitHookBypass',
    approvedBy: 'fixture-human',
    approvalText: 'Human fixture approval for hook bypass regression validation.',
    reason: 'Validate that hook bypass cannot override Team Broker conflict ownership.',
    surface: 'git commit --no-verify',
    allowedFlags: ['--no-verify'],
    ttlMinutes: 10,
    maxUses: 1
  });

  await assert.rejects(
    () => runAtmGit([
      'commit',
      '--cwd',
      repo,
      '--actor',
      'fixture-agent',
      '--message',
      'chore: blocked broker conflict bypass',
      '--no-verify',
      '--emergency-approval',
      lease.leaseId
    ]),
    (error: unknown) => {
      assert(error instanceof CliError);
      assert.equal(error.code, 'ATM_GIT_COMMIT_BROKER_CONFLICT_OVERRIDE_REQUIRED');
      const details = error.details as {
        conflictTaskId?: string;
        conflictFiles?: string[];
        hookBypassPermission?: string;
      };
      assert.equal(details.conflictTaskId, taskId);
      assert.deepEqual(details.conflictFiles, ['src/broker-owned.ts']);
      assert.equal(details.hookBypassPermission, 'backend.gitHookBypass');
      return true;
    }
  );
} finally {
  rmSync(repo, { recursive: true, force: true });
}

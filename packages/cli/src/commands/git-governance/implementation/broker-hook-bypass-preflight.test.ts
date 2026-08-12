import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertNoBrokerConflictBeforeHookBypass,
  consumeHookBypassAtProtectedWrite,
  preflightHookBypassEligibility,
} from './broker-hook-bypass-preflight.ts';
import { createEmergencyLease, readEmergencyLease } from '../../emergency/leases.ts';

const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('./broker-hook-bypass-preflight.ts', import.meta.url), 'utf8'));
assert.ok(
  source.indexOf('assertNoBrokerConflictBeforeHookBypass(options);') < source.indexOf('return assertEmergencyApproval({'),
  'broker admission must occur before a hook-bypass lease is consumed',
);

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-hook-bypass-candidate-'));
execFileSync('git', ['init', '-q'], { cwd });
mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-CURRENT.json'), JSON.stringify({
  workItemId: 'TASK-CURRENT', status: 'open', scopePaths: ['src/current.ts'],
  claim: { state: 'active', actorId: 'current' },
}));
writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-FOREIGN.json'), JSON.stringify({
  workItemId: 'TASK-FOREIGN', status: 'open', scopePaths: ['src/foreign.ts'],
  claim: { state: 'active', actorId: 'foreign' },
}));
mkdirSync(path.join(cwd, 'src'), { recursive: true });
writeFileSync(path.join(cwd, 'src', 'current.ts'), 'export const current = true;\n');
writeFileSync(path.join(cwd, 'src', 'foreign.ts'), 'export const foreign = true;\n');
execFileSync('git', ['add', '.'], { cwd });

assert.doesNotThrow(() => assertNoBrokerConflictBeforeHookBypass({
  cwd, taskId: 'TASK-CURRENT', actorId: 'current', candidateFiles: ['src/current.ts'],
  deferForeignStaged: false, command: 'fixture',
}), 'foreign shared-index residue outside the sealed candidate must not block');

assert.throws(() => assertNoBrokerConflictBeforeHookBypass({
  cwd, taskId: 'TASK-CURRENT', actorId: 'current', candidateFiles: ['src/foreign.ts'],
  deferForeignStaged: false, command: 'fixture',
}), (error: unknown) => (error as { code?: string }).code === 'ATM_GIT_COMMIT_BROKER_CONFLICT_OVERRIDE_REQUIRED');

const lease = createEmergencyLease({
  cwd,
  taskId: 'TASK-CURRENT',
  actorId: 'current',
  permission: 'backend.gitHookBypass',
  approvedBy: 'human',
  approvalText: 'Approve one governed hook bypass.',
  reason: 'fixture',
  surface: 'git commit --no-verify',
  allowedFlags: ['--no-verify'],
  ttlMinutes: 10,
  maxUses: 1,
}).lease;
const bypassRequest = {
  cwd, taskId: 'TASK-CURRENT', actorId: 'current', candidateFiles: ['src/current.ts'],
  deferForeignStaged: false, command: 'fixture', emergencyApproval: lease.leaseId,
};
preflightHookBypassEligibility(bypassRequest);
assert.equal(readEmergencyLease(cwd, lease.leaseId).usedCount, 0,
  'retryable preparation must not consume a one-use bypass lease');
consumeHookBypassAtProtectedWrite(bypassRequest);
assert.equal(readEmergencyLease(cwd, lease.leaseId).usedCount, 1,
  'the protected write boundary consumes the lease exactly once');

const executionSource = readFileSync(new URL('./commit-execution.ts', import.meta.url), 'utf8');
assert.ok(
  executionSource.indexOf('withBranchCommitQueueLock(') < executionSource.indexOf('executeHookBypassCommitBoundary('),
  'hook-bypass consumption must occur after branch queue admission',
);
const boundarySource = readFileSync(new URL('./hook-bypass-commit-boundary.ts', import.meta.url), 'utf8');
assert.ok(
  boundarySource.indexOf('consumeHookBypassAtProtectedWrite(') < boundarySource.indexOf('execFileSync('),
  'the protected boundary must consume before invoking Git',
);

console.log('broker-hook-bypass-preflight: candidate admission and deferred one-use consumption verified');

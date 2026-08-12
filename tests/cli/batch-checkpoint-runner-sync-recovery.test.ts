import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBatchCheckpointRunnerRecoveryArgs, categorizeCheckpointCloseFailure } from '../../packages/cli/src/commands/batch/runner-recovery-forwarding.ts';
import { isTaskflowOperatorLaneActive, withTaskflowOperatorLane } from '../../packages/cli/src/commands/emergency/context.ts';

assert.deepEqual(
  buildBatchCheckpointRunnerRecoveryArgs('EMG-RECOVERY-VALID'),
  ['--emergency-approval', 'EMG-RECOVERY-VALID', '--allow-stale-runner'],
  'a supplied recovery approval must make the batch adapter request the protected stale-runner path'
);

assert.equal(isTaskflowOperatorLaneActive(), false, 'test must begin outside the taskflow operator lane');
await withTaskflowOperatorLane(async () => {
  assert.equal(isTaskflowOperatorLaneActive(), true, 'batch checkpoint may use the operator lane for its ordinary close backend');
});
assert.equal(isTaskflowOperatorLaneActive(), false, 'operator lane must be released after the batch close callback');

const batchImplementation = readFileSync(path.join(process.cwd(), 'packages/cli/src/commands/batch/implementation.ts'), 'utf8');
const closeRunnerRecovery = readFileSync(path.join(process.cwd(), 'packages/cli/src/commands/tasks/close-orchestrator/runner-recovery.ts'), 'utf8');
assert.match(batchImplementation, /withTaskflowOperatorLane\(\(\) => runTasks\(\[ 'close'/, 'batch checkpoint must run its ordinary backend close in the taskflow operator lane');
assert.match(closeRunnerRecovery, /permission: 'backend\.runnerRecovery'[\s\S]*allowTaskflowOperatorLane: false/, 'stale-runner recovery must still require and consume its dedicated lease inside an operator lane');
assert.deepEqual(
  buildBatchCheckpointRunnerRecoveryArgs(null),
  [],
  'without an approval the batch adapter must preserve the stale-runner fail-closed default'
);

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-batch-checkpoint-recovery-'));
mkdirSync(repo, { recursive: true });
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '--allow-empty', '-m', 'base'], { cwd: repo, stdio: 'ignore' });
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

const runnerSync = categorizeCheckpointCloseFailure({
  ok: false,
  messages: [{ code: 'ATM_RUNNER_STALE_WRITE_REFUSED', data: { tldr: 'runner stale' } }]
}, 'ATM-GOV-0234', 'captain', repo);
assert.equal(runnerSync.category, 'runner-sync-required');
assert.match(runnerSync.requiredCommand ?? '', /broker runner-sync enqueue/);
assert.match(runnerSync.requiredCommand ?? '', new RegExp(head));
assert.match(runnerSync.requiredCommand ?? '', /--surface release\/atm-onefile\/atm\.mjs/);

const sourceFirst = categorizeCheckpointCloseFailure({
  ok: false,
  messages: [{ code: 'ATM_SOURCE_FIRST_WRITE_REFUSED', data: {} }]
}, 'ATM-GOV-0234', 'captain', repo);
assert.equal(sourceFirst.category, 'source-first-write-refused');
assert.equal(sourceFirst.requiredCommand, 'node atm.mjs batch checkpoint --actor captain --json');

const sharedQueue = categorizeCheckpointCloseFailure({
  ok: false,
  messages: [{ code: 'ATM_BROKER_SHARED_QUEUE_BLOCKED', data: {} }]
}, 'ATM-GOV-0235', 'captain', repo);
assert.equal(sharedQueue.category, 'broker-shared-queue-blocked');
assert.equal(sharedQueue.requiredCommand, 'node atm.mjs broker status --task ATM-GOV-0235 --json');

console.log('[batch-checkpoint-runner-sync-recovery.test] ok');

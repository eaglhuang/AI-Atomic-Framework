import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { categorizeCheckpointCloseFailure } from '../../packages/cli/src/commands/batch/implementation.ts';

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

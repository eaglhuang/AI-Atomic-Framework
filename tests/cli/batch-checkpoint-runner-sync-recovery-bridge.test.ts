import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { categorizeCheckpointCloseFailure } from '../../packages/cli/src/commands/batch/runner-recovery-forwarding.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-batch-checkpoint-bridge-'));
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '--allow-empty', '-m', 'base'], { cwd: repo, stdio: 'ignore' });
const candidateHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

const stale = categorizeCheckpointCloseFailure({
  ok: false,
  messages: [{ code: 'ATM_RUNNER_STALE_WRITE_REFUSED', data: { tldr: 'runner stale' } }]
}, 'TASK-MAO-0060', 'codex-gpt-5.4-mini', repo);

assert.equal(stale.recoveryBridge?.schemaId, 'atm.batchCheckpointRecoveryBridge.v1');
assert.equal(stale.recoveryBridge?.taskId, 'TASK-MAO-0060');
assert.equal(stale.recoveryBridge?.actorId, 'codex-gpt-5.4-mini');
assert.equal(stale.recoveryBridge?.candidateHead, candidateHead);
assert.equal(stale.recoveryBridge?.lifecycleMutation, false);
assert.match(stale.recoveryBridge?.nextCommand ?? '', /broker runner-sync enqueue/);

const sourceFirst = categorizeCheckpointCloseFailure({
  ok: false,
  messages: [{ code: 'ATM_SOURCE_FIRST_WRITE_REFUSED', data: {} }]
}, 'TASK-MAO-0060', 'codex-gpt-5.4-mini', repo);

assert.equal(sourceFirst.recoveryBridge?.schemaId, 'atm.batchCheckpointRecoveryBridge.v1');
assert.equal(sourceFirst.recoveryBridge?.candidateHead, candidateHead);
assert.equal(sourceFirst.recoveryBridge?.lifecycleMutation, false);
assert.match(sourceFirst.recoveryBridge?.nextCommand ?? '', /batch checkpoint/);

console.log('[batch-checkpoint-runner-sync-recovery-bridge.test] ok');

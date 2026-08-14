import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { consumeCloseTransactionHookReceipt } from '../../hook/pre-commit/close-transaction-receipt.ts';
import { issueCloseTransactionHookReceipt } from '../close-transaction-hook-receipt.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-close-hook-receipt-test-'));
const taskId = 'ATM-GOV-0389';
const actorId = 'receipt-test-captain';
const invocationNonce = 'receipt-test-invocation-nonce';
const lock = {
  schemaId: 'atm.closeWindowStagedIndexLock.v1' as const,
  specVersion: '0.1.0' as const,
  taskId,
  actorId,
  acquiredAt: '2026-08-14T00:00:00.000Z',
  status: 'active' as const,
  expectedStageFiles: ['governance.json'],
  foreignStagedSnapshotPath: null,
  foreignStagedEntries: [],
  unexpectedStagedTasks: [],
  releasedAt: null,
  releaseOutcome: null
};
const originalIndex = process.env.GIT_INDEX_FILE;
const originalTask = process.env.ATM_COMMIT_TASK_ID;
const originalActor = process.env.ATM_COMMIT_ACTOR_ID;

function git(args: readonly string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync('git', [...args], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

try {
  git(['init']);
  git(['config', 'user.name', 'ATM Fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  writeFileSync(path.join(root, 'README.md'), 'baseline\n');
  git(['add', 'README.md']);
  git(['commit', '-m', 'baseline']);
  writeFileSync(path.join(root, 'governance.json'), '{"verified":true}\n');
  const parentHead = git(['rev-parse', 'HEAD']);

  const issued = issueCloseTransactionHookReceipt({ root, taskId, actorId, invocationNonce, closeWindowLock: lock, stageFiles: ['governance.json'], parentHead });
  assert.ok(issued, 'producer must create a receipt from a sealed temporary index');

  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-close-hook-receipt-index-'));
  try {
    const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
    git(['read-tree', 'HEAD'], env);
    git(['add', '-A', '-f', '--', 'governance.json'], env);
    process.env.GIT_INDEX_FILE = env.GIT_INDEX_FILE;
    process.env.ATM_COMMIT_TASK_ID = taskId;
    process.env.ATM_COMMIT_ACTOR_ID = actorId;
    const wrongActor = consumeCloseTransactionHookReceipt({ root, taskId, actorId: 'different-captain', invocationNonce, commitSurface: 'taskflow-close-governance-followup', scopedIndexActive: true, closeWindowLock: lock, stagedFiles: ['governance.json'] });
    assert.equal(wrongActor.reusable, false, 'actor substitution must fail closed without consuming the receipt');
    const wrongInvocation = consumeCloseTransactionHookReceipt({ root, taskId, actorId, invocationNonce: 'other-invocation', commitSurface: 'taskflow-close-governance-followup', scopedIndexActive: true, closeWindowLock: lock, stagedFiles: ['governance.json'] });
    assert.equal(wrongInvocation.reusable, false, 'invocation substitution must fail closed without consuming the receipt');
    const accepted = consumeCloseTransactionHookReceipt({ root, taskId, actorId, invocationNonce, commitSurface: 'taskflow-close-governance-followup', scopedIndexActive: true, closeWindowLock: lock, stagedFiles: ['governance.json'] });
    assert.equal(accepted.reusable, true, accepted.reason);

    const rejected = consumeCloseTransactionHookReceipt({ root, taskId, actorId, invocationNonce, commitSurface: 'taskflow-close-governance-followup', scopedIndexActive: true, closeWindowLock: lock, stagedFiles: ['governance.json'] });
    assert.equal(rejected.reusable, false, 'receipt must be single-use');
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
} finally {
  if (originalIndex === undefined) delete process.env.GIT_INDEX_FILE; else process.env.GIT_INDEX_FILE = originalIndex;
  if (originalTask === undefined) delete process.env.ATM_COMMIT_TASK_ID; else process.env.ATM_COMMIT_TASK_ID = originalTask;
  if (originalActor === undefined) delete process.env.ATM_COMMIT_ACTOR_ID; else process.env.ATM_COMMIT_ACTOR_ID = originalActor;
  rmSync(root, { recursive: true, force: true });
}

console.log('[close-transaction-hook-receipt] ok');

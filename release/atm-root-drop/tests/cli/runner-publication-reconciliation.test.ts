import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveRunnerBuildOutputInventory } from '../../packages/core/src/broker/runner-build-output-inventory.ts';
import { reconcileReceiptOnlyRunnerPublicationResidue } from '../../packages/cli/src/commands/framework-development/runner-publication-lifecycle.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-g14-reconcile-'));
const receiptPath = '.atm/history/evidence/TASK-GIT-0019.runner-sync-receipt.json';

function write(relativePath: string, value: string) {
  const absolute = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, 'utf8');
}

function receipt(sealedSourceSha: string, marker: string, options?: { receiptPath?: string; taskId?: string; stewardWorkId?: string }) {
  const selectedReceiptPath = options?.receiptPath ?? receiptPath;
  const taskId = options?.taskId ?? 'TASK-GIT-0019';
  const outputInventory = deriveRunnerBuildOutputInventory({
    sealedSourceSha,
    observedPaths: [selectedReceiptPath, 'packages/cli/dist/atm.js', 'release/atm-onefile/atm.mjs'],
    currentTaskId: taskId
  });
  return `${JSON.stringify({
    schemaId: 'atm.runnerSyncReceipt.v1',
    taskId,
    stewardWorkId: options?.stewardWorkId ?? 'runner-sync-legacy',
    outputInventory,
    marker
  })}\n`;
}

try {
  execFileSync('git', ['init', '--quiet'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@atm.local'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'ATM test'], { cwd: repo });

  const committedReceipt = receipt('0123456789abcdef0123456789abcdef01234567', 'c'.repeat(1_100_000));
  write(receiptPath, committedReceipt);
  write('packages/cli/dist/atm.js', 'sealed output\n');
  write('release/atm-onefile/atm.mjs', 'sealed runner\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '--quiet', '-m', 'seed'], { cwd: repo });

  write(receiptPath, receipt('fedcba9876543210fedcba9876543210fedcba98', 'overwritten'));
  write('.atm/history/evidence/TASK-TMP-0005.residue-reconciliation.json', '{}\n');
  const restored = reconcileReceiptOnlyRunnerPublicationResidue({
    cwd: repo,
    taskId: 'TASK-GIT-0022',
    actorId: 'captain',
    receiptRef: receiptPath,
    activeStewardWorkIds: []
  });
  assert.equal(restored.decision, 'restored-from-head');
  assert.equal(readFileSync(path.join(repo, receiptPath), 'utf8'), committedReceipt);
  const recovery = JSON.parse(readFileSync(path.join(repo, '.atm/history/evidence/TASK-GIT-0022.runner-publication-recovery.json'), 'utf8'));
  assert.equal(recovery.schemaId, 'atm.runnerPublicationRecoveryLedger.v1');
  assert.equal(recovery.records[0].legacyReceiptPath, receiptPath);
  assert.equal(recovery.records[0].legacyTaskId, 'TASK-GIT-0019');

  write(receiptPath, receipt('fedcba9876543210fedcba9876543210fedcba98', 'dirty-again'));
  write('packages/cli/dist/atm.js', 'must not restore with dirty output\n');
  assert.throws(() => reconcileReceiptOnlyRunnerPublicationResidue({
    cwd: repo,
    taskId: 'TASK-GIT-0022',
    actorId: 'captain',
    receiptRef: receiptPath,
    activeStewardWorkIds: []
  }), /ATM_RUNNER_PUBLICATION_PENDING/);
  assert.match(readFileSync(path.join(repo, receiptPath), 'utf8'), /dirty-again/);

  write('packages/cli/dist/atm.js', 'sealed output\n');
  assert.throws(() => reconcileReceiptOnlyRunnerPublicationResidue({
    cwd: repo,
    taskId: 'TASK-GIT-0022',
    actorId: 'captain',
    receiptRef: receiptPath,
    activeStewardWorkIds: ['runner-sync-legacy']
  }), /ATM_RUNNER_SYNC_RESUME_REQUIRED/);

  const orphanPath = '.atm/history/evidence/ATM-FRAMEWORK-TEMP-orphan.runner-sync-receipt.json';
  write(orphanPath, receipt('0123456789abcdef0123456789abcdef01234567', 'untracked orphan', {
    receiptPath: orphanPath,
    taskId: 'ATM-FRAMEWORK-TEMP-orphan',
    stewardWorkId: 'runner-sync-orphan'
  }));
  const deleted = reconcileReceiptOnlyRunnerPublicationResidue({
    cwd: repo,
    taskId: 'TASK-GIT-0022',
    actorId: 'captain',
    receiptRef: orphanPath,
    activeStewardWorkIds: []
  });
  assert.equal(deleted.decision, 'deleted-untracked-orphan');
  assert.equal(deleted.expectedHeadDigest, null);
  assert.equal(deleted.restoredAfterDigest, null);
  assert.equal(existsSync(path.join(repo, orphanPath)), false);
  const appendedRecovery = JSON.parse(readFileSync(path.join(repo, '.atm/history/evidence/TASK-GIT-0022.runner-publication-recovery.json'), 'utf8'));
  assert.equal(appendedRecovery.records.length, 2);
  assert.equal(appendedRecovery.records[1].legacyReceiptPath, orphanPath);

  const governanceReceiptPath = '.atm/history/evidence/ATM-GOV-0328.runner-sync-receipt.json';
  write(governanceReceiptPath, receipt('0123456789abcdef0123456789abcdef01234567', 'governance orphan', {
    receiptPath: governanceReceiptPath,
    taskId: 'ATM-GOV-0328',
    stewardWorkId: 'runner-sync-governance-orphan'
  }));
  const governanceDeleted = reconcileReceiptOnlyRunnerPublicationResidue({
    cwd: repo,
    taskId: 'TASK-GIT-0022',
    actorId: 'captain',
    receiptRef: governanceReceiptPath,
    activeStewardWorkIds: []
  });
  assert.equal(governanceDeleted.decision, 'deleted-untracked-orphan');
  assert.equal(governanceDeleted.legacyTaskId, 'ATM-GOV-0328');
  assert.equal(existsSync(path.join(repo, governanceReceiptPath)), false);
  console.log('[runner-publication-reconciliation.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

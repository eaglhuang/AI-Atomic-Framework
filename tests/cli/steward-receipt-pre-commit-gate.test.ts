import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { inspectSameFileClaimOwnership } from '../../packages/cli/src/commands/hook/pre-commit/support.ts';
import { readActiveTaskDirectionLocks } from '../../packages/cli/src/commands/task-direction.ts';
import { normalizeRelativePath } from '../../packages/cli/src/commands/hook/git-index-diagnostics.ts';
import {
  ATM_BROKER_STEWARD_RECEIPT_INVALID,
  ATM_BROKER_STEWARD_RECEIPT_REQUIRED,
  SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID
} from '../../packages/core/src/broker/shared-write-provenance-policy.ts';

const cwd = mkdtempSync(path.join(tmpdir(), 'atm-steward-receipt-gate-'));
const sharedFile = 'packages/core/src/shared-surface.ts';

function git(args: readonly string[]): string {
  const result = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function writeDirectionLock(taskId: string): void {
  const dir = path.join(cwd, '.atm', 'runtime', 'task-direction-locks');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${taskId}.json`), JSON.stringify({
    schemaId: 'atm.taskDirectionLock.v1',
    taskId,
    actorId: `actor-${taskId.toLowerCase()}`,
    status: 'active',
    allowedFiles: [sharedFile]
  }), 'utf8');
}

function writeSharedFile(body: string): void {
  mkdirSync(path.join(cwd, path.dirname(sharedFile)), { recursive: true });
  writeFileSync(path.join(cwd, sharedFile), body, 'utf8');
  git(['add', '--', sharedFile]);
}

function writeReceipt(overrides: Record<string, unknown> = {}): void {
  const dir = path.join(cwd, '.atm', 'history', 'evidence');
  mkdirSync(dir, { recursive: true });
  const head = git(['rev-parse', 'HEAD']);
  const blob = git(['rev-parse', `:${sharedFile}`]);
  writeFileSync(path.join(dir, 'steward.shared-write-provenance.json'), JSON.stringify({
    schemaId: SHARED_WRITE_PROVENANCE_RECEIPT_SCHEMA_ID,
    receiptId: 'receipt-pre-commit',
    canonicalRoot: normalizeRelativePath(cwd) || cwd,
    baseSha: head,
    headSha: head,
    compositionPlanDigest: `sha256:${'1'.repeat(64)}`,
    candidateOutputDigest: `sha256:${'2'.repeat(64)}`,
    serializabilityProofDigest: `sha256:${'3'.repeat(64)}`,
    stewardId: 'steward-1',
    stewardRole: 'neutral-steward',
    memberTaskIds: ['TASK-A', 'TASK-B'],
    fileDigests: { [sharedFile]: `git-blob:${blob}` },
    canonicalWriteCount: 1,
    semanticAuthorization: {
      schemaId: 'atm.stewardSemanticValidationReceipt.v1',
      candidateDigest: `sha256:${'1'.repeat(64)}`,
      outputDigest: `sha256:${'2'.repeat(64)}`,
      decisionVerdict: 'pass',
      ok: true
    },
    semanticBaseHeadSha: head,
    semanticSealedSelectionSourceDigest: `sha256:${'4'.repeat(64)}`,
    semanticRunnerBuildDigest: `sha256:${'5'.repeat(64)}`,
    issuedAt: new Date().toISOString(),
    consumedAt: null,
    ...overrides
  }), 'utf8');
}

function inspect() {
  return inspectSameFileClaimOwnership({
    cwd,
    stagedFiles: [sharedFile],
    activeDirectionLocks: readActiveTaskDirectionLocks(cwd),
    exemptAllowedFileSets: []
  });
}

try {
  git(['init']);
  git(['config', 'user.email', 'atm@example.invalid']);
  git(['config', 'user.name', 'ATM Test']);
  writeSharedFile('export const shared = 1;\n');
  git(['commit', '--no-verify', '-m', 'baseline']);

  writeDirectionLock('TASK-A');
  writeDirectionLock('TASK-B');
  writeSharedFile('export const shared = 2;\n');
  process.env.ATM_COMMIT_TASK_ID = 'TASK-A';

  // The committing task owns one of the two claims and still fails closed.
  const withoutReceipt = inspect();
  assert.equal(withoutReceipt.ok, false, 'multi-claim shared write must fail closed without a receipt');
  assert.equal(withoutReceipt.findings[0].code, ATM_BROKER_STEWARD_RECEIPT_REQUIRED);
  assert.equal(withoutReceipt.findings[0].file, sharedFile);

  writeReceipt();
  const withReceipt = inspect();
  assert.equal(withReceipt.ok, true, `valid steward receipt must admit: ${JSON.stringify(withReceipt.findings)}`);
  assert.deepEqual(withReceipt.sharedWriteAdmission?.admittedFiles, [sharedFile]);

  // One changed byte invalidates the receipt binding.
  writeSharedFile('export const shared = 3;\n');
  const changedBytes = inspect();
  assert.equal(changedBytes.ok, false);
  assert.equal(changedBytes.findings[0].code, ATM_BROKER_STEWARD_RECEIPT_INVALID);

  // A single-claim private write stays unaffected by the shared-write gate.
  rmSync(path.join(cwd, '.atm', 'runtime', 'task-direction-locks', 'TASK-B.json'));
  writeReceipt();
  const singleClaim = inspect();
  assert.equal(singleClaim.ok, true, `single-claim write must not be receipt-gated: ${JSON.stringify(singleClaim.findings)}`);
  assert.equal(singleClaim.sharedWriteAdmission, null);

  console.log('steward-receipt-pre-commit-gate.test passed');
} finally {
  delete process.env.ATM_COMMIT_TASK_ID;
  rmSync(cwd, { recursive: true, force: true });
}

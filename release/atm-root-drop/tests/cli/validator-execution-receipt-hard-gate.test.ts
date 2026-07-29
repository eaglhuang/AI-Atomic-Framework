import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import path from 'node:path';
import {
  buildValidationReceiptInput,
  readReusableValidationReceipt,
  writeValidationReceipt,
  MICRO_EVIDENCE_RECEIPT_SCHEMA_ID
} from '../../packages/core/src/evidence/validation-receipt.ts';

const CWD = process.cwd();
const SCOPE_PATHS = ['packages/core/src/evidence/validation-receipt.ts'];

// Clean up test store before running
const TEST_STORE = path.join(CWD, '.atm', 'runtime', 'validation-receipts');
try { rmSync(TEST_STORE, { recursive: true, force: true }); } catch {}

// 1. Valid execution with positive case and assertion count succeeds
{
  const receipt = buildValidationReceiptInput({
    cwd: CWD,
    validatorName: 'test-valid-run',
    command: 'node --strip-types tests/cli/sample.test.ts',
    status: 'passed',
    ok: true,
    gitHead: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    result: { caseCount: 5, assertionCount: 12 },
    scopePaths: SCOPE_PATHS
  });

  assert.equal(receipt.schemaId, MICRO_EVIDENCE_RECEIPT_SCHEMA_ID);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.ok, true);
  assert.equal(receipt.result.caseCount, 5);
  assert.equal(receipt.result.assertionCount, 12);

  writeValidationReceipt(CWD, receipt);

  const reuse = readReusableValidationReceipt({
    cwd: CWD,
    validatorName: 'test-valid-run',
    command: 'node --strip-types tests/cli/sample.test.ts',
    gitHead: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    scopePaths: SCOPE_PATHS
  });

  assert.equal(reuse.reusable, true);
  assert.equal(reuse.receipt?.receiptId, receipt.receiptId);
}

// 2. Negative fixture: zero-case success is rejected by hard gate
{
  const receipt = buildValidationReceiptInput({
    cwd: CWD,
    validatorName: 'test-zero-case',
    command: 'node --strip-types tests/cli/empty.test.ts',
    status: 'passed',
    ok: true,
    gitHead: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    result: { caseCount: 0, assertionCount: 0 },
    scopePaths: SCOPE_PATHS
  });

  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.ok, false);
  assert.ok(receipt.result.failureReason?.includes('ZERO_CASE_SUCCESS_REJECTED'));
  assert.ok(receipt.result.recoveryRoute?.length);
}

// 3. Negative fixture: zero-assertion success is rejected by hard gate
{
  const receipt = buildValidationReceiptInput({
    cwd: CWD,
    validatorName: 'test-zero-assertion',
    command: 'node --strip-types tests/cli/no-assert.test.ts',
    status: 'passed',
    ok: true,
    gitHead: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    result: { caseCount: 3, assertionCount: 0 },
    scopePaths: SCOPE_PATHS
  });

  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.ok, false);
  assert.ok(receipt.result.failureReason?.includes('ZERO_ASSERTION_SUCCESS_REJECTED'));
}

// 4. Negative fixture: advisory or quarantined results cannot satisfy required acceptance
{
  const advisoryReceipt = buildValidationReceiptInput({
    cwd: CWD,
    validatorName: 'test-advisory',
    command: 'node --strip-types tests/cli/advisory.test.ts',
    status: 'passed',
    ok: true,
    gitHead: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    result: { caseCount: 2, assertionCount: 5, advisory: true },
    scopePaths: SCOPE_PATHS
  });

  assert.equal(advisoryReceipt.status, 'failed');
  assert.equal(advisoryReceipt.ok, false);
  assert.ok(advisoryReceipt.result.failureReason?.includes('ADVISORY_CANNOT_SATISFY_REQUIRED'));

  const quarantinedReceipt = buildValidationReceiptInput({
    cwd: CWD,
    validatorName: 'test-quarantined',
    command: 'node --strip-types tests/cli/quarantined.test.ts',
    status: 'passed',
    ok: true,
    gitHead: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
    result: { caseCount: 2, assertionCount: 5, quarantineStatus: 'isolated' },
    scopePaths: SCOPE_PATHS
  });

  assert.equal(quarantinedReceipt.status, 'failed');
  assert.equal(quarantinedReceipt.ok, false);
  assert.ok(quarantinedReceipt.result.failureReason?.includes('QUARANTINED_CANNOT_SATISFY_REQUIRED'));
}

// 5. Negative fixture: cache reuse mismatch across candidate, scope, test, group, runner, environment
{
  const baseReceipt = buildValidationReceiptInput({
    cwd: CWD,
    validatorName: 'test-reuse-mismatch',
    command: 'node --strip-types tests/cli/reuse.test.ts',
    status: 'passed',
    ok: true,
    gitHead: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    result: { caseCount: 1, assertionCount: 1 },
    scopePaths: SCOPE_PATHS,
    groupName: 'groupA',
    runnerIdentity: 'runnerX'
  });
  writeValidationReceipt(CWD, baseReceipt);

  // Group mismatch
  const groupMismatch = readReusableValidationReceipt({
    cwd: CWD,
    validatorName: 'test-reuse-mismatch',
    command: 'node --strip-types tests/cli/reuse.test.ts',
    gitHead: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    scopePaths: SCOPE_PATHS,
    groupName: 'groupB',
    runnerIdentity: 'runnerX'
  });
  assert.equal(groupMismatch.reusable, false);

  // Runner identity mismatch
  const runnerMismatch = readReusableValidationReceipt({
    cwd: CWD,
    validatorName: 'test-reuse-mismatch',
    command: 'node --strip-types tests/cli/reuse.test.ts',
    gitHead: 'sha256:2222222222222222222222222222222222222222222222222222222222222222',
    scopePaths: SCOPE_PATHS,
    groupName: 'groupA',
    runnerIdentity: 'runnerY'
  });
  assert.equal(runnerMismatch.reusable, false);

  // Git head / candidate mismatch
  const gitHeadMismatch = readReusableValidationReceipt({
    cwd: CWD,
    validatorName: 'test-reuse-mismatch',
    command: 'node --strip-types tests/cli/reuse.test.ts',
    gitHead: 'sha256:3333333333333333333333333333333333333333333333333333333333333333',
    scopePaths: SCOPE_PATHS,
    groupName: 'groupA',
    runnerIdentity: 'runnerX'
  });
  assert.equal(gitHeadMismatch.reusable, false);
}

console.log('validator-execution-receipt-hard-gate.test.ts passed');

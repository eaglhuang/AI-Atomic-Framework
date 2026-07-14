import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MICRO_EVIDENCE_RECEIPT_SCHEMA_ID,
  buildValidationReceiptInput,
  readReusableValidationReceipt,
  validationReceiptContentPath,
  validationReceiptIndexPath,
  writeValidationReceipt
} from '../../packages/core/src/evidence/validation-receipt.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tempDir = path.join(root, '.atm-temp-test-validation-receipt-reuse');

try {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(path.join(tempDir, 'packages/core/src/evidence'), { recursive: true });
  const scopeFile = 'packages/core/src/evidence/example.ts';
  writeFileSync(path.join(tempDir, scopeFile), 'export const value = 1;\n', 'utf8');

  const baseInput = {
    cwd: tempDir,
    validatorName: 'validate-example',
    command: 'node --strip-types scripts/validate-example.ts --mode standard',
    status: 'passed' as const,
    ok: true,
    gitHead: 'abc123',
    result: {
      name: 'validate-example',
      ok: true,
      exitCode: 0
    },
    scopePaths: [scopeFile]
  };

  const receipt = buildValidationReceiptInput(baseInput);
  const writeResult = writeValidationReceipt(tempDir, receipt);
  assert.equal(receipt.schemaId, MICRO_EVIDENCE_RECEIPT_SCHEMA_ID);
  assert.ok(existsSync(writeResult.receiptPath), 'content-addressed receipt object must be written');
  assert.ok(existsSync(writeResult.indexPath), 'reuse index must be written');
  assert.equal(writeResult.attempts, 1, 'normal atomic write should complete on first attempt');
  assert.equal(validationReceiptContentPath(tempDir, receipt.receiptId), writeResult.receiptPath);
  assert.equal(validationReceiptIndexPath(tempDir, receipt.reuseKey), writeResult.indexPath);

  const stored = JSON.parse(readFileSync(writeResult.receiptPath, 'utf8'));
  assert.equal(stored.schemaId, MICRO_EVIDENCE_RECEIPT_SCHEMA_ID);
  assert.equal(stored.receiptId, receipt.receiptId);
  assert.equal(stored.reuseKey, receipt.reuseKey);

  const reusable = readReusableValidationReceipt({
    cwd: tempDir,
    validatorName: baseInput.validatorName,
    command: baseInput.command,
    gitHead: baseInput.gitHead,
    scopePaths: baseInput.scopePaths
  });
  assert.equal(reusable.reusable, true, `expected receipt to be reusable: ${JSON.stringify(reusable)}`);
  assert.equal(reusable.receipt?.receiptId, receipt.receiptId);

  writeFileSync(path.join(tempDir, scopeFile), 'export const value = 2;\n', 'utf8');
  const changedScope = readReusableValidationReceipt({
    cwd: tempDir,
    validatorName: baseInput.validatorName,
    command: baseInput.command,
    gitHead: baseInput.gitHead,
    scopePaths: baseInput.scopePaths
  });
  assert.equal(changedScope.reusable, false, 'changed conservative scope must invalidate reuse');
  assert.equal(changedScope.reason, 'missing-index');

  const differentCommand = readReusableValidationReceipt({
    cwd: tempDir,
    validatorName: baseInput.validatorName,
    command: `${baseInput.command} --extra`,
    gitHead: baseInput.gitHead,
    scopePaths: baseInput.scopePaths
  });
  assert.equal(differentCommand.reusable, false, 'changed command must invalidate reuse');

  console.log('[validation-receipt-reuse:test] ok');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

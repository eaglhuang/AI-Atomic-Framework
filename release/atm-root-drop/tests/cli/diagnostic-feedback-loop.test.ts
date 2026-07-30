import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runEvidence } from '../../packages/cli/src/commands/evidence.ts';

const sha = (digit: string) => `sha256:${digit.repeat(64)}`;
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-diagnostic-loop-'));

const blocked = await runEvidence([
  'diagnose',
  '--cwd', tempRoot,
  '--task', 'TASK-SKL-0033',
  '--symptom', 'task closes without reproducing symptom',
  '--reproducer-command', 'node atm.mjs next --json',
  '--reproducer-exit-code', '0',
  '--reproducer-stdout-sha256', sha('1'),
  '--reproducer-stderr-sha256', sha('2'),
  '--reproduction-rate', '0',
  '--minimized-fixture', 'fixture-id',
  '--candidate-digest', sha('3'),
  '--environment-digest', sha('4'),
  '--hypothesis', 'h1|model-only||node --strip-types tests/noop.test.ts|inconclusive',
  '--winning-hypothesis', 'h1',
  '--regression-case-id', 'test_task_skl_0033_diagnostic_loop_4cc1c8b1',
  '--green-command', 'node --strip-types tests/noop.test.ts',
  '--green-exit-code', '0',
  '--green-stdout-sha256', sha('5'),
  '--green-stderr-sha256', sha('6'),
  '--json'
]) as any;

assert.equal(blocked.ok, false);
assert.equal(blocked.evidence.receipt.admission, 'fail-closed');
assert(blocked.evidence.receipt.reasons.includes('symptom-not-observed'));

const valid = await runEvidence([
  'diagnose',
  '--cwd', tempRoot,
  '--task', 'TASK-SKL-0033',
  '--symptom', 'task closes without reproducing symptom',
  '--reproducer-command', 'node atm.mjs next --claim --task TASK-LEAK --json',
  '--reproducer-exit-code', '1',
  '--reproducer-stdout-sha256', sha('1'),
  '--reproducer-stderr-sha256', sha('2'),
  '--symptom-observed',
  '--reproduction-rate', '1',
  '--minimized-fixture', 'tests/fixtures/diagnostic-loop',
  '--candidate-digest', sha('3'),
  '--environment-digest', sha('4'),
  '--hypothesis', 'h1|missing admission gate|receipt has no red-capable reproducer|node --strip-types tests/cli/diagnostic-feedback-loop.test.ts|matched',
  '--winning-hypothesis', 'h1',
  '--regression-case-id', 'test_task_skl_0033_diagnostic_loop_4cc1c8b1',
  '--green-command', 'node --strip-types tests/cli/diagnostic-feedback-loop.test.ts',
  '--green-exit-code', '0',
  '--green-stdout-sha256', sha('5'),
  '--green-stderr-sha256', sha('6'),
  '--temporary-instrumentation', 'removed',
  '--write',
  '--json'
]) as any;

assert.equal(valid.ok, true);
assert.equal(valid.evidence.receipt.valid, true);
const receiptPath = path.join(tempRoot, valid.evidence.receiptPath);
const stored = JSON.parse(readFileSync(receiptPath, 'utf8'));
assert.equal(stored.schemaId, 'atm.diagnosticLoopReceipt.v1');
assert.equal(stored.regressionCaseId, 'test_task_skl_0033_diagnostic_loop_4cc1c8b1');

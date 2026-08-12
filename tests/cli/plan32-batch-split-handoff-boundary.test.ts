import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-plan32-batch-split-handoff-boundary.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.plan32BatchSplitHandoffBoundaryValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'batch-split-and-handoff-separated');
assert.equal(report.batchId, 'batch-2522d44aebb6');
assert.equal(report.childTaskCount, 2);
assert.deepEqual(report.diagnostics, [
  'batch-checkpoint-required',
  'handoff-is-continuation-only',
  'handoff-cannot-close-batch',
  'queue-head-only'
]);

console.log('plan32 batch split handoff boundary ok');

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-plan32-parallel-prepare-outside-queue.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.plan32ParallelPrepareOutsideQueueValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'queue-residency-minimal');
assert.equal(report.queueResidencyMs, 4500);
assert.deepEqual(report.diagnostics, [
  'prepare-outside-queue',
  'validation-outside-queue',
  'critical-section-only'
]);

console.log('plan32 parallel prepare outside queue ok');

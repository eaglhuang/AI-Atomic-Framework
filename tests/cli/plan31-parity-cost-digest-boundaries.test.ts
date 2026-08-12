import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-plan31-parity-cost-digest-boundaries.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.plan31ParityCostDigestBoundariesValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'plan31-parity-cost-digest-boundaries-proven');
assert.deepEqual(report.rowsCovered, ['P31-OBJ-08', 'P31-OBJ-15', 'P31-OBJ-18', 'P31-OBJ-19']);
assert.deepEqual(report.diagnostics, [
  'old-new-frozen-digest-replayable',
  'cost-correctness-separated',
  'parity-breaker-digests',
  'runner-sync-digest-visible'
]);

console.log('plan31 parity cost digest boundaries ok');

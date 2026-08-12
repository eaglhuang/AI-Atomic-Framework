import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-plan30-parity-policy-boundaries.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.plan30ParityPolicyBoundariesValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'plan30-parity-policy-boundaries-proven');
assert.deepEqual(report.rowsCovered, ['P30-OBJ-03', 'P30-OBJ-04', 'P30-OBJ-10']);
assert.deepEqual(report.diagnostics, [
  'source-frozen-parity-digests',
  'release-adopter-parity-observable',
  'locked-policy-no-correctness-debt'
]);

console.log('plan30 parity policy boundaries ok');

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-plan30-closure-evidence-boundaries.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.plan30ClosureEvidenceBoundariesValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'plan30-closure-boundaries-command-backed');
assert.deepEqual(report.rowsCovered, ['P30-OBJ-01', 'P30-OBJ-09', 'P30-OBJ-11', 'P30-OBJ-14']);
assert.deepEqual(report.diagnostics, [
  'divergence-command-backed',
  'closure-predicate-not-caller-asserted',
  'telemetry-not-correctness',
  'circuit-breaker-reset-digest'
]);

console.log('plan30 closure evidence boundaries ok');

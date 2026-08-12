import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-plan30-operational-state-safety.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.plan30OperationalStateSafetyValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'plan30-operational-state-safety-proven');
assert.deepEqual(report.rowsCovered, ['P30-OBJ-05', 'P30-OBJ-06', 'P30-OBJ-17']);
assert.deepEqual(report.diagnostics, [
  'rollback-path-preserved',
  'exactly-once-transition-durable',
  'legacy-authority-retirement-deferred'
]);

console.log('plan30 operational state safety ok');

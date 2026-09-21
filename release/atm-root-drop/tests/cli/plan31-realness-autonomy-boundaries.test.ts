import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-plan31-realness-autonomy-boundaries.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.plan31RealnessAutonomyBoundariesValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'plan31-realness-autonomy-boundaries-proven');
assert.deepEqual(report.rowsCovered, ['P31-OBJ-01', 'P31-OBJ-05', 'P31-OBJ-22']);
assert.deepEqual(report.diagnostics, [
  'missing-class-command-backed',
  'stale-history-rejected',
  'emergency-not-autonomous-replay'
]);

console.log('plan31 realness autonomy boundaries ok');

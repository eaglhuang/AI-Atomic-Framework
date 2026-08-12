import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-plan32-foundation-runner-boundaries.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.plan32FoundationRunnerBoundariesValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'plan32-foundation-runner-boundaries-proven');
assert.deepEqual(report.rowsCovered, ['P32-OBJ-03', 'P32-OBJ-07', 'P32-OBJ-10', 'P32-OBJ-14', 'P32-OBJ-15', 'P32-OBJ-21']);

console.log('plan32 foundation runner boundaries ok');

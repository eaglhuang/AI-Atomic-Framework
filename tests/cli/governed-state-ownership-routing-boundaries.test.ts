import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-governed-state-ownership-routing-boundaries.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.governedStateOwnershipRoutingBoundariesValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'governed-state-ownership-routing-boundaries-proven');
assert.deepEqual(report.rowsCovered, [
  'P31-OBJ-04',
  'P31-OBJ-10',
  'P31-OBJ-16',
  'P31-OBJ-21',
  'P31-OBJ-23',
  'P32-OBJ-13',
  'P32-OBJ-17',
  'P32-OBJ-20',
  'P32-OBJ-25'
]);

console.log('governed state ownership routing boundaries ok');

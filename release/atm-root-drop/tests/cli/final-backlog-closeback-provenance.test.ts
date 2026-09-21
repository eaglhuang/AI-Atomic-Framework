import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-final-backlog-closeback-provenance.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.finalBacklogClosebackProvenanceValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'final-backlog-closeback-provenance-boundaries-proven');
assert.deepEqual(report.rowsCovered, ['P30-OBJ-15', 'P30-OBJ-16', 'P32-OBJ-06', 'P32-OBJ-28']);
assert.deepEqual(report.diagnostics, [
  'backlog-census-machine-readable',
  'closeback-sha-explicit',
  'close-seam-visible',
  'final-release-push-sha-required'
]);

console.log('final backlog closeback provenance ok');

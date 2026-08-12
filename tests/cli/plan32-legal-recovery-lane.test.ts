import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-plan32-legal-recovery-lane.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.plan32LegalRecoveryLaneValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'legal-recovery-lane-named');
assert.equal(report.laneName, 'atm-git-pathspec-emergency-commit');
assert.deepEqual(report.diagnostics, [
  'lane-named',
  'authority-preconditions-before-use',
  'emergency-not-success-metric',
  'exact-keep-list-required',
  'post-commit-and-backlog-required'
]);

console.log('plan32 legal recovery lane ok');

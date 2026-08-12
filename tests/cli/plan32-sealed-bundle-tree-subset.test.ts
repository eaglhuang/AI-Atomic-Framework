import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-plan32-sealed-bundle-tree-subset.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.plan32SealedBundleTreeSubsetValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'sealed-bundle-is-tree-subset');
assert.equal(report.sealedPathCount, 2);
assert.equal(report.candidatePathCount, 3);
assert.equal(report.foreignResidueCount, 2);
assert.deepEqual(report.diagnostics, [
  'sealed-paths-subset-of-candidate-tree',
  'foreign-live-surface-excluded',
  'empty-missing-from-candidate'
]);

console.log('plan32 sealed bundle tree subset ok');

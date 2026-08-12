import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-plan32-shared-delivery-no-override.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.plan32SharedDeliveryNoOverrideValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'shared-delivery-separated-from-override');
assert.equal(report.deliveryMode, 'steward-composed');
assert.equal(report.overrideLeasePresent, false);
assert.deepEqual(report.diagnostics, [
  'shared-delivery-authorized',
  'member-attribution-required',
  'override-lease-absent',
  'manual-foreign-bytes-forbidden'
]);

console.log('plan32 shared delivery no override ok');

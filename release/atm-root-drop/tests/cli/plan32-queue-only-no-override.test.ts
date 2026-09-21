import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync('node', ['--strip-types', 'scripts/validate-plan32-queue-only-no-override.ts', '--json'], { encoding: 'utf8' });
const receipt = JSON.parse(output);

assert.equal(receipt.schemaId, 'atm.plan32QueueOnlyNoOverrideValidation.v1');
assert.equal(receipt.ok, true);
assert.equal(receipt.verdict, 'wait-only');
assert.equal(receipt.queueRequired, true);
assert.equal(receipt.overridePresent, false);
assert(receipt.diagnostics.includes('queue-is-required'));
assert(receipt.diagnostics.includes('override-lease-absent'));
assert(receipt.diagnostics.includes('wait-does-not-green'));

console.log('plan32-queue-only-no-override.test.ts: ok');

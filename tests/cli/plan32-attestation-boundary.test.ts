import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync('node', ['--strip-types', 'scripts/validate-plan32-attestation-boundary.ts', '--json'], { encoding: 'utf8' });
const receipt = JSON.parse(output);

assert.equal(receipt.schemaId, 'atm.plan32AttestationBoundaryValidation.v1');
assert.equal(receipt.ok, true);
assert.equal(receipt.verdict, 'not-complete');
assert.equal(receipt.failClosed, true);
assert(receipt.diagnostics.includes('attestation-is-not-machine-proof'));
assert(receipt.diagnostics.includes('prose-must-not-green'));

console.log('plan32-attestation-boundary.test.ts: ok');

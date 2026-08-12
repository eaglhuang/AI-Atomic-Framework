import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync('node', ['--strip-types', 'scripts/validate-plan32-terminal-verdict-fail-closed.ts', '--json'], { encoding: 'utf8' });
const receipt = JSON.parse(output);

assert.equal(receipt.schemaId, 'atm.plan32TerminalVerdictFailClosedValidation.v1');
assert.equal(receipt.ok, true);
assert.equal(receipt.denominator, 29);
assert.equal(receipt.verified, 11);
assert.equal(receipt.notComplete, 18);
assert.equal(receipt.verdict, 'not-complete');
assert.equal(receipt.failClosed, true);

console.log('plan32-terminal-verdict-fail-closed.test.ts: ok');

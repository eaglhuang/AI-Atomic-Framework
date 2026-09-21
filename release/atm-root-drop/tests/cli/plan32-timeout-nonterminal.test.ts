import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync('node', ['--strip-types', 'scripts/validate-plan32-timeout-nonterminal.ts', '--json'], { encoding: 'utf8' });
const receipt = JSON.parse(output);

assert.equal(receipt.schemaId, 'atm.plan32TimeoutNonterminalValidation.v1');
assert.equal(receipt.ok, true);
assert.equal(receipt.verdict, 'not-complete');
assert.equal(receipt.failClosed, true);
assert(receipt.diagnostics.includes('timeout-is-nonterminal'));
assert(receipt.diagnostics.includes('timeout-must-not-green'));

console.log('plan32-timeout-nonterminal.test.ts: ok');

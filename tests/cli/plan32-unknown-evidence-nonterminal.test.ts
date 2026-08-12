import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync('node', ['--strip-types', 'scripts/validate-plan32-unknown-evidence-nonterminal.ts', '--json'], { encoding: 'utf8' });
const receipt = JSON.parse(output);

assert.equal(receipt.schemaId, 'atm.plan32UnknownEvidenceNonterminalValidation.v1');
assert.equal(receipt.ok, true);
assert.equal(receipt.verdict, 'not-complete');
assert.equal(receipt.failClosed, true);
assert(receipt.diagnostics.includes('unknown-evidence-is-nonterminal'));
assert(receipt.diagnostics.includes('unknown-must-not-green'));

console.log('plan32-unknown-evidence-nonterminal.test.ts: ok');

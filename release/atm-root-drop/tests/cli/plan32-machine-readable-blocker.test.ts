import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = execFileSync('node', ['--strip-types', 'scripts/validate-plan32-machine-readable-blocker.ts', '--json'], { encoding: 'utf8' });
const receipt = JSON.parse(output);

assert.equal(receipt.schemaId, 'atm.plan32MachineReadableBlockerValidation.v1');
assert.equal(receipt.ok, true);
assert.equal(receipt.verdict, 'machine-readable-nonterminal-blocker');
assert.equal(receipt.status, 'not-complete');
assert(receipt.diagnostics.includes('blocker-code-present'));
assert(receipt.diagnostics.includes('next-safe-command-present'));
assert(receipt.diagnostics.includes('terminal-false'));

console.log('plan32-machine-readable-blocker.test.ts: ok');

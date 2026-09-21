import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync('node', ['--strip-types', 'scripts/validate-plan30-protected-closure.ts', '--json'], { encoding: 'utf8' });
const result = JSON.parse(stdout);

assert.equal(result.schemaId, 'atm.plan30ProtectedClosureValidation.v1');
assert.equal(result.ok, true);
assert.equal(result.failClosed, true);
assert.equal(result.cellCount, 420);
assert.equal(result.commandBackedCount, 420);

console.log('plan30-protected-closure.test.ts: ok');

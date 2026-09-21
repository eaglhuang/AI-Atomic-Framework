import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync('node', ['--strip-types', 'scripts/validate-plan32-provenance-mismatch.ts', '--json'], { encoding: 'utf8' });
const result = JSON.parse(stdout);

assert.equal(result.schemaId, 'atm.plan32ProvenanceMismatchValidation.v1');
assert.equal(result.ok, true);
assert.equal(result.verdict, 'fail-closed');
assert.equal(result.failClosed, true);
assert.deepEqual(result.diagnostics, ['head-mismatch', 'task-provenance-mismatch']);

console.log('plan32-provenance-mismatch.test.ts: ok');

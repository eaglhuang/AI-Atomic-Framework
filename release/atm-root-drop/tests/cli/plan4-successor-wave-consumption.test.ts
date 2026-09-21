import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const output = JSON.parse(
  execFileSync('node', ['--strip-types', 'scripts/validate-plan4-successor-wave-consumption.ts', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
);

assert.equal(output.schemaId, 'atm.plan4SuccessorWaveConsumptionValidation.v1');
assert.equal(output.ok, true);
assert.equal(output.verdict, 'plan4-successor-wave-consumed');
assert.equal(output.objectiveCount, 17);
assert.deepEqual(output.findings, []);
assert.ok(output.diagnostics.includes('successor-map-17-of-17'));
assert.ok(output.diagnostics.includes('source-report-digests-current'));
assert.ok(output.diagnostics.includes('six-editor-parity-current'));

console.log('plan4-successor-wave-consumption.test.ts: ok');

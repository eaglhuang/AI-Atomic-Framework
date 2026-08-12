import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const good = spawnSync(process.execPath, [
  '--strip-types',
  'scripts/validate-atm-3-final-closure.ts',
  '--mode',
  'validate',
  '--json'
], { encoding: 'utf8' });

assert.equal(good.status, 0, good.stderr || good.stdout);
const goodJson = JSON.parse(good.stdout);
assert.equal(goodJson.schemaId, 'atm.planObjectiveReplayValidation.v1');
assert.equal(goodJson.ok, true);
assert.equal(goodJson.planId, '3.0');
assert.equal(goodJson.rowCount, 17);
assert.equal(goodJson.notComplete, 17);

const fakeGreen = spawnSync(process.execPath, [
  '--strip-types',
  'scripts/validate-atm-3-final-closure.ts',
  '--mode',
  'validate',
  '--input',
  'tests/fixtures/plan3-fake-green/plan30-incomplete-objective.json',
  '--json'
], { encoding: 'utf8' });

assert.notEqual(fakeGreen.status, 0, 'fake-green fixture must fail closed');
const fakeJson = JSON.parse(fakeGreen.stdout);
assert.equal(fakeJson.ok, false);
assert(fakeJson.findings.some((entry: string) => entry.includes('expected 17 objective rows')));
assert(fakeJson.findings.some((entry: string) => entry.includes('complete verdict requires every row verified')));

console.log('atm 3 final closure replay ok');

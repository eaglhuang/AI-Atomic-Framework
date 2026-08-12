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
assert.equal(goodJson.verified, 5);
assert.equal(goodJson.notComplete, 12);

const plan31 = spawnSync(process.execPath, [
  '--strip-types',
  'scripts/validate-atm-3-final-closure.ts',
  '--mode',
  'validate',
  '--plan',
  '3.1',
  '--expect-rows',
  '23',
  '--input',
  'docs/reports/plan-3-1-objective-replay.json',
  '--json'
], { encoding: 'utf8' });

assert.equal(plan31.status, 0, plan31.stderr || plan31.stdout);
const plan31Json = JSON.parse(plan31.stdout);
assert.equal(plan31Json.schemaId, 'atm.planObjectiveReplayValidation.v1');
assert.equal(plan31Json.ok, true);
assert.equal(plan31Json.planId, '3.1');
assert.equal(plan31Json.rowCount, 23);
assert.equal(plan31Json.verified, 5);
assert.equal(plan31Json.notComplete, 18);

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

const fakePlan31 = spawnSync(process.execPath, [
  '--strip-types',
  'scripts/validate-atm-3-final-closure.ts',
  '--mode',
  'validate',
  '--plan',
  '3.1',
  '--expect-rows',
  '23',
  '--input',
  'tests/fixtures/plan3-fake-green/plan31-incomplete-objective.json',
  '--json'
], { encoding: 'utf8' });

assert.notEqual(fakePlan31.status, 0, 'Plan 3.1 fake-green fixture must fail closed');
const fakePlan31Json = JSON.parse(fakePlan31.stdout);
assert.equal(fakePlan31Json.ok, false);
assert(fakePlan31Json.findings.some((entry: string) => entry.includes('expected 23 objective rows')));
assert(fakePlan31Json.findings.some((entry: string) => entry.includes('complete verdict requires every row verified')));

const plan32 = spawnSync(process.execPath, [
  '--strip-types',
  'scripts/validate-atm-3-final-closure.ts',
  '--mode',
  'validate',
  '--plan',
  '3.2',
  '--expect-rows',
  '29',
  '--input',
  'docs/reports/plan-3-2-objective-replay.json',
  '--json'
], { encoding: 'utf8' });

assert.equal(plan32.status, 0, plan32.stderr || plan32.stdout);
const plan32Json = JSON.parse(plan32.stdout);
assert.equal(plan32Json.schemaId, 'atm.planObjectiveReplayValidation.v1');
assert.equal(plan32Json.ok, true);
assert.equal(plan32Json.planId, '3.2');
assert.equal(plan32Json.rowCount, 29);
assert.equal(plan32Json.verified, 11);
assert.equal(plan32Json.notComplete, 18);

const fakePlan32 = spawnSync(process.execPath, [
  '--strip-types',
  'scripts/validate-atm-3-final-closure.ts',
  '--mode',
  'validate',
  '--plan',
  '3.2',
  '--expect-rows',
  '29',
  '--input',
  'tests/fixtures/plan3-fake-green/plan32-incomplete-objective.json',
  '--json'
], { encoding: 'utf8' });

assert.notEqual(fakePlan32.status, 0, 'Plan 3.2 fake-green fixture must fail closed');
const fakePlan32Json = JSON.parse(fakePlan32.stdout);
assert.equal(fakePlan32Json.ok, false);
assert(fakePlan32Json.findings.some((entry: string) => entry.includes('expected 29 objective rows')));
assert(fakePlan32Json.findings.some((entry: string) => entry.includes('complete verdict requires every row verified')));

console.log('atm 3 final closure replay ok');

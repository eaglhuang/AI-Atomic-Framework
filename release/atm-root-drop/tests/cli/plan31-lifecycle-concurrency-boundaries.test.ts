import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const stdout = execFileSync(
  process.execPath,
  ['--strip-types', 'scripts/validate-plan31-lifecycle-concurrency-boundaries.ts', '--json'],
  { encoding: 'utf8' }
);
const report = JSON.parse(stdout);

assert.equal(report.schemaId, 'atm.plan31LifecycleConcurrencyBoundariesValidation.v1');
assert.equal(report.ok, true);
assert.equal(report.verdict, 'plan31-lifecycle-concurrency-boundaries-proven');
assert.deepEqual(report.rowsCovered, ['P31-OBJ-06', 'P31-OBJ-11', 'P31-OBJ-12', 'P31-OBJ-14', 'P31-OBJ-17', 'P31-OBJ-20']);
assert.deepEqual(report.diagnostics, [
  'two-key-close-causal',
  'queue-wakeup-observable',
  'lifecycle-command-backed',
  'sealed-set-live-index-separated',
  'rollback-retained',
  'actor-continuity-replayable'
]);

console.log('plan31 lifecycle concurrency boundaries ok');

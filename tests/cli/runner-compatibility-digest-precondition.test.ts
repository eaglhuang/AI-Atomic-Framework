import assert from 'node:assert/strict';
import { readRunnerCompatibilityDigest } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const report = readRunnerCompatibilityDigest(process.cwd());
assert.equal(report.schemaId, 'atm.runnerCompatibilityDigest.v1');
assert.equal(typeof report.compatible, 'boolean');
assert.equal(typeof report.sourceDriftSyncRequired, 'boolean');
if (report.sourceSealDigest !== null) {
  assert.match(report.sourceSealDigest, /^sha256:[a-f0-9]{64}$/i);
}
if (report.frozenRunnerDigest !== null) {
  assert.match(report.frozenRunnerDigest, /^sha256:[a-f0-9]{64}$/i);
}
assert.equal(
  report.compatible,
  !report.sourceDriftSyncRequired || report.frozenRunnerPath === null,
  'a stale frozen runner must never be reported compatible'
);
console.log('[runner-compatibility-digest-precondition] ok');

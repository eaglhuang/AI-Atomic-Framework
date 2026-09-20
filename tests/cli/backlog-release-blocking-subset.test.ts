import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('docs/reports/plan-3x-4x-backlog-release-blocking-subset.json', 'utf8'));

assert.equal(report.schemaId, 'atm.backlogReleaseBlockingSubset.v1');
assert.equal(report.status, 'release-blocking-subset-separated');
// Backlog sizes move as items are opened and closed. What must hold is the
// arithmetic of the subset and the release-blocking invariant; the validator
// below re-derives the totals from the live backlog and fails on drift.
for (const key of ['backlogTotal', 'terminal', 'deferred', 'releaseBlockingNow', 'needsTaskCardBeforeFinalRelease', 'ownerTrackedDeferred'] as const) {
  assert.ok(Number.isInteger(report.totals[key]) && report.totals[key] >= 0, `totals.${key} must be a count`);
}
assert.equal(report.totals.terminal + report.totals.deferred, report.totals.backlogTotal, 'terminal and deferred must partition the backlog');
assert.ok(report.totals.ownerTrackedDeferred <= report.totals.deferred);
assert.ok(report.totals.needsTaskCardBeforeFinalRelease <= report.totals.deferred);
assert.equal(report.totals.releaseBlockingNow, 0, 'the subset exists to keep the release-blocking count at zero');
assert.deepEqual(report.nextExecutionOrder.map((entry: any) => entry.id), [
  'task-cardize-unowned-deferred',
  'sample-owner-tracked-deferred',
  'recompute-backlog-census'
]);

execFileSync('node', ['--strip-types', 'scripts/validate-backlog-release-blocking-subset.ts'], { stdio: 'pipe' });
console.log('backlog-release-blocking-subset.test.ts: ok');

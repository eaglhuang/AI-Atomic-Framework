import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('docs/reports/plan-3x-4x-backlog-release-blocking-subset.json', 'utf8'));

assert.equal(report.schemaId, 'atm.backlogReleaseBlockingSubset.v1');
assert.equal(report.status, 'release-blocking-subset-separated');
assert.equal(report.totals.backlogTotal, 391);
assert.equal(report.totals.terminal, 219);
assert.equal(report.totals.deferred, 170);
assert.equal(report.totals.releaseBlockingNow, 0);
assert.equal(report.totals.needsTaskCardBeforeFinalRelease, 133);
assert.equal(report.totals.ownerTrackedDeferred, 37);
assert.deepEqual(report.nextExecutionOrder.map((entry: any) => entry.id), [
  'task-cardize-unowned-deferred',
  'sample-owner-tracked-deferred',
  'recompute-backlog-census'
]);

execFileSync('node', ['--strip-types', 'scripts/validate-backlog-release-blocking-subset.ts'], { stdio: 'pipe' });
console.log('backlog-release-blocking-subset.test.ts: ok');

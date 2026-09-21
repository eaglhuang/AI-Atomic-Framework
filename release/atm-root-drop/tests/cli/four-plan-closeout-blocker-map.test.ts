import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('docs/reports/plan-3x-4x-closeout-blocker-map.json', 'utf8'));

assert.equal(report.schemaId, 'atm.fourPlanCloseoutBlockerMap.v1');
// This map is an execution dashboard over live plan data, so its totals move.
// Assert the contract instead: the status must agree with the unresolved count,
// every total must be a count, and each blocker class must carry a known
// status. The validator below recomputes the map and fails on drift.
const certified = report.status === 'complete-closeout-certified';
assert.ok(['complete-closeout-certified', 'actionable-not-complete'].includes(report.status), `unexpected status ${report.status}`);
// Certification follows the remaining execution order; zero unresolved rows is
// necessary but not sufficient, so the implication runs one way.
if (certified) {
  assert.equal(report.totals.unresolvedObjectiveRows, 0, 'a certified map cannot carry unresolved objective rows');
  assert.equal(report.totals.certificateDimensionsNotComplete, 0, 'a certified map cannot carry incomplete certificate dimensions');
}
for (const [key, value] of Object.entries(report.totals as Record<string, unknown>)) {
  assert.ok(Number.isInteger(value) && (value as number) >= 0, `totals.${key} must be a count`);
}
assert.equal(report.totals.backlogReleaseBlockingNow, 0, 'nothing may block the release from this map');
for (const id of ['B1-current-row-proof', 'B2-plan4-successor-wave', 'B4-backlog-disposition', 'B5-release-certificate']) {
  const entry = report.blockerClasses.find((candidate: any) => candidate.id === id);
  assert.ok(entry, `blocker class ${id} must stay in the map`);
  assert.ok(['resolved', 'open', 'in-progress'].includes(entry.status), `blocker class ${id} has unexpected status ${entry.status}`);
}
assert.equal(certified, report.nextExecutionOrder.length === 0, 'a certified map must have nothing left to execute');

execFileSync('node', ['--strip-types', 'scripts/validate-four-plan-closeout-blocker-map.ts'], { stdio: 'pipe' });
console.log('four-plan-closeout-blocker-map.test.ts: ok');

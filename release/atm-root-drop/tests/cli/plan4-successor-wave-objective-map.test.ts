import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('docs/reports/plan4-successor-wave-objective-map.json', 'utf8'));

assert.equal(report.schemaId, 'atm.plan4SuccessorWaveObjectiveMap.v1');
assert.equal(report.status, 'successor-evidence-mapped');
assert.equal(report.nonClaim, 'This map proves successor-wave evidence coverage for Plan 4 anchors; it does not complete Plan 3.x objective rows.');
assert.equal(report.totals.foundationAnchors, 17);
assert.equal(report.totals.mappedAnchors, 17);
assert.equal(report.totals.unmappedAnchors, 0);
assert.equal(new Set(report.objectiveMappings.map((entry: any) => entry.objectiveId)).size, 17);
assert.ok(report.objectiveMappings.every((entry: any) => entry.status === 'successor-evidence-present'));

execFileSync('node', ['--strip-types', 'scripts/validate-plan4-successor-wave-objective-map.ts'], { stdio: 'pipe' });
console.log('plan4-successor-wave-objective-map.test.ts: ok');

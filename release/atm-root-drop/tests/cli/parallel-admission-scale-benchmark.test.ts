import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const analyzer = join(root, 'scripts/analyze-captain-parallel-ledger.ts');
const output = execFileSync(process.execPath, ['--strip-types', analyzer, '--validate', '--require-sealed-cohorts'], { cwd: root, encoding: 'utf8' });
const report = JSON.parse(output);
const v4 = report.planPerformanceReport.realPairedAbV4;

assert.equal(v4.arms.length, 4);
for (const arm of v4.arms) {
  assert.equal(arm.cellCount, 35, `${arm.arm} must enumerate 7 scales x 5 contention cells`);
  assert.equal(arm.missingCellCount, 0, `${arm.arm} must not omit required cells`);
  assert.equal(arm.sufficientCellCount, 0);
  assert.equal(arm.insufficientCellCount, 35);
  assert.equal(arm.verdict, 'inconclusive');
}

assert.equal(v4.supplementalSamplingProposal.length, 4);
assert.ok(v4.supplementalSamplingProposal.every((entry: string) => entry.includes('35 insufficient cells, 0 missing cells')));
assert.equal(report.planPerformanceReport.rolloutVerdict.overall, 'inconclusive');
assert.notEqual(report.planPerformanceReport.rolloutVerdict.reason, 'All rollout dimensions have comparable positive evidence.');
assert.ok(!JSON.stringify(report).includes('compose O(1)'));
assert.ok(report.planPerformanceReport.dataDrivenDecision.missingData.some((entry: string) => entry.includes('serial')));
assert.ok(report.planPerformanceReport.dataDrivenDecision.missingData.some((entry: string) => entry.includes('isolated-git-branch-merge')));

console.log('parallel-admission-scale-benchmark ok');

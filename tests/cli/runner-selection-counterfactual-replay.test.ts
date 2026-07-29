import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--strip-types', 'scripts/runner-version-selection-replay.ts'], {
  cwd: process.cwd(),
  encoding: 'utf8'
});

assert.equal(result.status, 0, result.stderr);
const report = JSON.parse(result.stdout);

assert.equal(report.schemaId, 'atm.runnerSelectionQualificationReport.v1');
assert.equal(report.caseCount, 7);
assert.equal(report.verdictCounts.qualified, 2);
assert.equal(report.verdictCounts['pending-contract'], 1);
assert.equal(report.promotionPreconditions.promotionAllowed, false);
assert.equal(report.promotionPreconditions.zeroFalseCompatible, true);
assert.ok(report.metrics.perCapabilityCoverage.counterfactual >= 7);
assert.ok(report.results.some((entry: { caseId: string }) => entry.caseId === 'newer-runner-input-segment-revalidation'));

console.log('runner-selection-counterfactual-replay.test.ts: 8 cases passed');

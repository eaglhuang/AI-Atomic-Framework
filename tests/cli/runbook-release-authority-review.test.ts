import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { inspectCompletion } from '../../scripts/review-runbook-release-authority.ts';

const broken = '{"rows":[{"itemId":"RB-001","status":"proven"}],"waveExits":[{"itemId":"EXIT-01"}],';
const inspection = inspectCompletion(broken);
assert.equal(inspection.parseable, false);
assert.ok(inspection.findings.some((finding: string) => finding.startsWith('completion-report-json-invalid:')));

const duplicate = JSON.stringify({
  expectedItemCount: 112,
  rows: Array.from({ length: 112 }, () => ({ itemId: 'RB-001', status: 'proven', evidence: [] })),
  waveExits: Array.from({ length: 11 }, () => ({ itemId: 'EXIT-01', status: 'proven', evidence: [] }))
});
const duplicateInspection = inspectCompletion(duplicate);
assert.ok(duplicateInspection.findings.includes('rows-array-invalid'));
assert.ok(duplicateInspection.findings.includes('wave-exits-array-invalid'));
assert.ok(duplicateInspection.findings.includes('proven-without-evidence:RB-001'));

execFileSync(process.execPath, ['--strip-types', 'scripts/review-runbook-release-authority.ts', '--mode', 'write', '--offline'], { stdio: 'pipe' });
execFileSync(process.execPath, ['--strip-types', 'scripts/review-runbook-release-authority.ts', '--mode', 'validate', '--offline'], { stdio: 'pipe' });
const report = JSON.parse(readFileSync('docs/reports/reviews/plan-3x-4x-runbook-release-review.json', 'utf8'));
assert.equal(report.schemaId, 'atm.fourPlanIndependentReleaseReview.v1');
assert.equal(report.verdict, 'not-proven');
assert.equal(report.remote.error, 'remote-observation-disabled');
assert.equal(report.remote.remoteHeadAfterReview, undefined);
assert.equal(report.completion.parseable, inspectCompletion(readFileSync('docs/reports/plan-3x-4x-runbook-completion-evidence.json', 'utf8')).parseable);
assert.ok(report.nonClaims.includes('does-not-read-independent-certificate'));
console.log('runbook-release-authority-review.test.ts: ok');

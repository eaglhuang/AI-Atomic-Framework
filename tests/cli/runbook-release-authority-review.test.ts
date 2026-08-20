import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectCompletion, isValidValidatorContract, sealedRemotePublishVerdict } from '../../scripts/review-runbook-release-authority.ts';
import { semanticTaskCardDigest } from '../../scripts/task-card-contract-digest.ts';

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

const temporaryOutput = join(mkdtempSync(join(tmpdir(), 'atm-release-review-')), 'review.json');
const temporaryCard = join(mkdtempSync(join(tmpdir(), 'atm-validator-contract-')), 'ATM-GOV-9000.task.md');
const planningCard = 'task_id: ATM-GOV-9000\nstatus: planned\nvalidators:\n  - npm run typecheck\n';
const lifecycleOnlyCloseback = planningCard.replace('status: planned', 'status: done\nclosedAt: 2026-08-20T00:00:00Z');
writeFileSync(temporaryCard, lifecycleOnlyCloseback, 'utf8');
const semanticContract = {
  contractId: `atm.taskCardValidator/ATM-GOV-9000/${'a'.repeat(64)}`,
  taskId: 'ATM-GOV-9000', taskCardPath: temporaryCard,
  taskCardDigest: semanticTaskCardDigest(planningCard), command: 'npm run typecheck'
};
assert.notEqual(semanticContract.taskCardDigest, `sha256:${createHash('sha256').update(lifecycleOnlyCloseback).digest('hex')}`);
assert.equal(isValidValidatorContract(semanticContract), true, 'reviewer must consume the producer semantic digest across lifecycle-only changes');
assert.equal(isValidValidatorContract({ ...semanticContract, taskCardDigest: `sha256:${'0'.repeat(64)}` }), false, 'semantic content drift remains fail-closed');
const reviewArgs = ['--strip-types', 'scripts/review-runbook-release-authority.ts', '--offline', '--output', temporaryOutput];
execFileSync(process.execPath, [...reviewArgs, '--mode', 'write'], { stdio: 'pipe' });
execFileSync(process.execPath, [...reviewArgs, '--mode', 'validate'], { stdio: 'pipe' });
const report = JSON.parse(readFileSync(temporaryOutput, 'utf8'));
assert.equal(report.schemaId, 'atm.fourPlanIndependentReleaseReview.v1');
assert.equal(report.verdict, 'not-proven');
assert.equal(report.remote.error, 'remote-observation-disabled');
assert.equal(report.remote.remoteHeadAfterReview, undefined);
assert.equal(report.completion.parseable, inspectCompletion(readFileSync('docs/reports/plan-3x-4x-runbook-completion-evidence.json', 'utf8')).parseable);
assert.ok(report.nonClaims.includes('does-not-read-independent-certificate'));

const parent = execFileSync('git', ['rev-parse', 'HEAD~1'], { encoding: 'utf8' }).trim();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(sealedRemotePublishVerdict(parent, head), 'already-published');
assert.equal(sealedRemotePublishVerdict(head, head), 'already-published');
assert.equal(sealedRemotePublishVerdict(head, parent), 'not-proven');

// A sealed timestamp may be replayed, but its declared authority inputs may
// never be replayed from an altered projection.
report.inputDigests[0].digest = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
writeFileSync(temporaryOutput, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
assert.throws(() => execFileSync(process.execPath, [...reviewArgs, '--mode', 'validate'], { stdio: 'pipe' }));
console.log('runbook-release-authority-review.test.ts: ok');

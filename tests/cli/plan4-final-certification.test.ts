import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJson = (relativePath: string) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const audit = readJson('governance-optimization/plan-3x-4x-objective-audit-2026-07-31.json');

assert.equal(audit.schemaId, 'atm.fourPlanCertificate.v1');
assert.equal(audit.decision.failClosed, true);
assert.deepEqual(audit.rows.map((row: any) => row.plan), ['3.0', '3.1', '3.2', '4.0']);

for (const row of audit.rows.filter((entry: any) => entry.plan !== '4.0')) {
  const tuple = row.evidenceTuples[0];
  const replay = readJson(tuple.source);
  assert.equal(replay.schemaId, tuple.expectedSchemaId);
  assert.equal(replay.denominator, row.expectedObjectives);
  assert.equal(replay.rows.length, row.expectedObjectives);
  assert.equal(new Set(replay.rows.map((entry: any) => entry.objectiveId)).size, row.expectedObjectives);
  assert.equal(replay.statusCounts.verified, row.expectedObjectives);
  assert.equal(replay.statusCounts['not-complete'], 0);
  assert.equal(replay.statusCounts.unknown, 0);
  assert.equal(replay.statusCounts.conflicting, 0);
  assert.ok(replay.rows.every((entry: any) => entry.status === 'verified' && entry.blockers.length === 0));
}

const plan4 = audit.rows.find((row: any) => row.plan === '4.0');
const foundation = readJson(plan4.evidenceTuples[0].source);
assert.equal(foundation.schemaId, 'atm.plan4FoundationReplay.v1');
assert.equal(foundation.taskId, 'ATM-GOV-0336');
assert.equal(foundation.plan4ObjectiveDenominator.expected, 17);
assert.equal(foundation.plan4ObjectiveDenominator.observed, 17);
assert.equal(foundation.plan4ObjectiveDenominator.status, 'ready');

const census = readJson(audit.backlogCensus.sources[0]);
const waiver = readJson(audit.backlogCensus.sources[1]);
assert.equal(census.schemaId, 'atm.backlogCensus.v1');
assert.equal(census.ok, true);
assert.deepEqual(census.invalid, []);
assert.deepEqual(census.openLikeIds, []);
assert.deepEqual(census.unresolvedIds, []);
assert.equal(waiver.status, 'waived-for-release-closeout');
assert.equal(waiver.totals.releaseBlockingNow, 0);
assert.equal(waiver.totals.unclassified, 0);
assert.equal(waiver.waiverAuthority.followUpRequired, true);

const closeback = readJson(audit.releasePushProvenance.source);
assert.equal(closeback.schemaId, 'atm.fourPlanReleaseCloseback.v1');
assert.equal(closeback.status, 'pushed');
assert.equal(closeback.targetHead, closeback.originMain);
execFileSync('git', ['merge-base', '--is-ancestor', closeback.targetHead, 'origin/main'], { stdio: 'ignore' });

const independent = readJson(audit.independentReview.source);
assert.equal(independent.schemaId, 'atm.fourPlanIndependentCertificate.v1');
assert.equal(independent.status, 'proven');
assert.equal(independent.overallVerdict, 'complete');
assert.equal(independent.releaseAuthorized, true);
assert.ok(independent.reviewers.length >= independent.minimumIndependentReviewers);
for (const dimension of ['objective-verdict', 'card-state-verdict', 'incident-verdict', 'freshness-verdict', 'charter-verdict', 'release-verdict']) {
  assert.equal(independent.dimensions.find((entry: any) => entry.dimensionId === dimension)?.status, 'proven');
}

const sharedControls = [audit.backlogCensus, audit.releasePushProvenance, audit.independentReview];
const certificateCanBeProven = audit.rows.every((row: any) => row.status === 'proven')
  && audit.unknownRows.length === 0
  && audit.unresolvedRows.length === 0
  && sharedControls.every((control: any) => control.status === 'proven')
  && audit.legacyAuthority.reversible === true;
assert.equal(certificateCanBeProven, true);
assert.equal(audit.status, 'proven');
assert.equal(audit.legacyAuthority.retired, true);
assert.equal(audit.resultDigest, independent.certificateDigest);

const matrix = fs.readFileSync(path.join(root, 'governance-optimization/plan-3x-4x-objective-evidence-matrix-2026-07-31.md'), 'utf8');
for (const plan of ['3.0', '3.1', '3.2', '4.0']) assert.ok(matrix.includes(`| ${plan} |`));
assert.ok(matrix.includes('fail-closed certification input'));
console.log('plan4 final certification: proven');

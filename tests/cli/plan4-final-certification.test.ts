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
const targetReachable = closeback.targetHead === closeback.originMain
  || (() => {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', closeback.targetHead, 'origin/main'], { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  })();
assert.equal(closeback.remoteReachability?.checked, true);
assert.equal(closeback.remoteReachability?.targetHeadReachableFromOriginMain, targetReachable);
assert.equal(closeback.remoteReachability?.status, targetReachable ? 'pushed' : 'not-pushed');
assert.equal(closeback.status, targetReachable ? 'pushed' : 'not-pushed');
assert.equal(audit.releasePushProvenance.status === 'proven', targetReachable);

const independent = readJson(audit.independentReview.source);
assert.equal(independent.schemaId, 'atm.fourPlanIndependentCertificate.v1');
const blockerMap = readJson('docs/reports/plan-3x-4x-closeout-blocker-map.json');

// The audit binds itself to one certificate by digest. If that binding is
// broken the audit is describing a certificate that no longer exists, which is
// the failure this file must catch rather than restate.
assert.equal(
  audit.resultDigest,
  independent.certificateDigest,
  'the canonical audit must be bound to the certificate it consumes'
);
assert.equal(
  blockerMap.sourceReports.find((entry: any) => entry.path === audit.independentReview.source)?.digest,
  independent.certificateDigest,
  'the closeout blocker map must bind to the same certificate consumed by the canonical audit'
);

// An independent certificate only counts reviewers that survived its own
// independence checks. reviewers.length is a count of declarations, not of
// reviews, and the difference is exactly how a placeholder review passed here.
assert.ok(
  independent.independentReviewerCount <= independent.reviewers.length,
  'the certificate cannot count more independent reviewers than it declares'
);
const independentReviewProven = independent.status === 'proven'
  && independent.overallVerdict === 'complete'
  && independent.releaseAuthorized === true
  && independent.diagnostics.length === 0
  && independent.independentReviewerCount >= independent.minimumIndependentReviewers
  && ['objective-verdict', 'card-state-verdict', 'incident-verdict', 'freshness-verdict', 'charter-verdict', 'release-verdict']
    .every((dimension) => independent.dimensions.find((entry: any) => entry.dimensionId === dimension)?.status === 'proven');
assert.equal(
  audit.independentReview.status === 'proven',
  independentReviewProven,
  `the audit's independent-review control must agree with the certificate; certificate diagnostics: ${independent.diagnostics.join(', ') || 'none'}`
);

// Recompute the canonical verdict from the audit's own decision rule instead of
// reading the status it stored. A stored status is a claim; this is the check.
const sharedControls = [audit.backlogCensus, audit.releasePushProvenance, audit.independentReview];
const certificateCanBeProven = audit.rows.every((row: any) => row.status === 'proven')
  && audit.unknownRows.length === 0
  && audit.unresolvedRows.length === 0
  && sharedControls.every((control: any) => control.status === 'proven')
  && independentReviewProven
  && audit.legacyAuthority.reversible === true;
assert.equal(
  audit.status === 'proven',
  certificateCanBeProven,
  `the canonical audit status must follow from its inputs, not be asserted over them; recomputed=${certificateCanBeProven}, stored=${audit.status}`
);
assert.equal(
  audit.legacyAuthority.retired,
  certificateCanBeProven,
  'legacy authority may only be retired while the certification actually holds'
);
if (!certificateCanBeProven) {
  assert.ok(
    Array.isArray(audit.supersession?.blockers) && audit.supersession.blockers.length > 0,
    'a downgraded canonical audit must record why, so the downgrade is auditable rather than silent'
  );
}

const matrix = fs.readFileSync(path.join(root, 'governance-optimization/plan-3x-4x-objective-evidence-matrix-2026-07-31.md'), 'utf8');
for (const plan of ['3.0', '3.1', '3.2', '4.0']) assert.ok(matrix.includes(`| ${plan} |`));
assert.ok(matrix.includes('fail-closed certification input'));
console.log(`plan4 final certification: ${certificateCanBeProven ? 'proven' : 'not-certified'}`);

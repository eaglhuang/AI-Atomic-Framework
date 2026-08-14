import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  compileFourPlanIndependentCertificate,
  composeEvidenceDigest,
  validateFourPlanIndependentCertificate
} from '../../packages/core/src/evidence/four-plan-independent-certificate.ts';

const hex = (seed: string): string => `sha256:${seed.repeat(64).slice(0, 64)}`;
const commit = (seed: string): string => seed.repeat(40).slice(0, 40);

const evidenceDigests: Record<string, string> = {
  'docs/reports/objectives.json': hex('1'),
  'docs/reports/cards.json': hex('2'),
  'docs/reports/incidents.json': hex('3'),
  'docs/reports/freshness.json': hex('4'),
  'docs/reports/charter.json': hex('5'),
  'docs/reports/reviewer-a.json': hex('6'),
  'docs/reports/reviewer-b.json': hex('7')
};

const observation = (path: string) => ({
  path,
  present: true,
  digest: evidenceDigests[path] ?? hex('0'),
  tracked: true,
  dirty: false,
  lastCommit: commit('a'),
  reachableFromTargetHead: true
});

const base = {
  certificateId: 'cert-0341',
  certificatePath: 'docs/reports/certificate.json',
  generatedAt: '2026-08-12T00:00:00.000Z',
  writerRole: 'certificate-writer',
  reviewers: [
    {
      reviewerId: 'reviewer-a',
      roles: ['independent-reviewer'],
      outputPath: 'docs/reports/reviewer-a.json',
      digest: evidenceDigests['docs/reports/reviewer-a.json'],
      inputPaths: ['docs/reports/objectives.json'],
      inputDigests: [evidenceDigests['docs/reports/objectives.json']]
    },
    {
      reviewerId: 'reviewer-b',
      roles: ['independent-reviewer'],
      outputPath: 'docs/reports/reviewer-b.json',
      digest: evidenceDigests['docs/reports/reviewer-b.json'],
      inputPaths: ['docs/reports/cards.json'],
      inputDigests: [evidenceDigests['docs/reports/cards.json']]
    }
  ],
  minimumIndependentReviewers: 2,
  forbiddenReviewerRoles: ['certificate-writer', 'fixture-generator', 'implementer', 'evidence-producer', 'closure-actor', 'override-approver'],
  dimensions: [
    { dimensionId: 'objective-verdict', status: 'proven' as const, digest: evidenceDigests['docs/reports/objectives.json'], evidenceRefs: ['docs/reports/objectives.json'] },
    { dimensionId: 'card-state-verdict', status: 'proven' as const, digest: evidenceDigests['docs/reports/cards.json'], evidenceRefs: ['docs/reports/cards.json'] },
    { dimensionId: 'incident-verdict', status: 'proven' as const, digest: evidenceDigests['docs/reports/incidents.json'], evidenceRefs: ['docs/reports/incidents.json'] },
    { dimensionId: 'freshness-verdict', status: 'proven' as const, digest: evidenceDigests['docs/reports/freshness.json'], evidenceRefs: ['docs/reports/freshness.json'] },
    { dimensionId: 'charter-verdict', status: 'proven' as const, digest: evidenceDigests['docs/reports/charter.json'], evidenceRefs: ['docs/reports/charter.json'] }
  ],
  evidenceObservations: Object.keys(evidenceDigests).map(observation),
  releaseSurfaces: [
    { surfaceId: 'target-head', expectedDigest: commit('b'), observedDigest: commit('b'), reachable: true },
    { surfaceId: 'origin-main', expectedDigest: commit('b'), observedDigest: commit('b'), reachable: true },
    { surfaceId: 'frozen-runner', expectedDigest: hex('8'), observedDigest: hex('8'), reachable: true },
    { surfaceId: 'root-drop', expectedDigest: hex('9'), observedDigest: hex('9'), reachable: true }
  ],
  mutationControls: ['byte-stable-digest', 'fail-closed-verdict'],
  provenance: { taskId: 'ATM-GOV-0341' }
};

// A certificate whose every observation supports it can still be complete. If
// this stops holding, the hardening below has become a refusal to ever certify.
const proven = compileFourPlanIndependentCertificate(base);
assert.equal(proven.schemaId, 'atm.fourPlanIndependentCertificate.v1');
assert.deepEqual(proven.diagnostics, []);
assert.equal(proven.status, 'proven');
assert.equal(proven.overallVerdict, 'complete');
assert.equal(proven.releaseAuthorized, true);
assert.equal(proven.independentReviewerCount, 2);
assert.deepEqual(validateFourPlanIndependentCertificate(proven), { ok: true, diagnostics: [] });

const schema = JSON.parse(readFileSync('schemas/evidence/four-plan-independent-certificate.schema.json', 'utf8'));
const validateSchema = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
assert.equal(validateSchema(proven), true, JSON.stringify(validateSchema.errors));

// test_atm_gov_0360_placeholder_reviewer_digest_fails_closed
const placeholder = compileFourPlanIndependentCertificate({
  ...base,
  reviewers: [
    { ...base.reviewers[0], digest: 'sha256:pending-self-digest' },
    base.reviewers[1]
  ]
});
assert.ok(
  placeholder.diagnostics.includes('reviewer-digest-malformed:reviewer-a'),
  `a placeholder digest must not pass as a digest; observed: ${placeholder.diagnostics.join(', ')}`
);
assert.equal(placeholder.status, 'contradictory');
assert.equal(placeholder.overallVerdict, 'not-complete');
assert.equal(placeholder.independentReviewerCount, 1);

const malformedDimensionDigest = compileFourPlanIndependentCertificate({
  ...base,
  dimensions: [{ ...base.dimensions[0], digest: 'sha256:pending' }, ...base.dimensions.slice(1)]
});
assert.ok(malformedDimensionDigest.diagnostics.includes('dimension-digest-malformed:objective-verdict'));

// test_atm_gov_0360_reviewer_independence_is_structural
const selfReferential = compileFourPlanIndependentCertificate({
  ...base,
  reviewers: [
    { ...base.reviewers[0], outputPath: base.certificatePath },
    base.reviewers[1]
  ]
});
assert.ok(
  selfReferential.diagnostics.includes('reviewer-output-self-reference:reviewer-a'),
  `a reviewer cannot review the certificate it signs; observed: ${selfReferential.diagnostics.join(', ')}`
);
assert.equal(selfReferential.independentReviewerCount, 1);
assert.ok(selfReferential.diagnostics.includes('independent-reviewer-count-insufficient'));

const reviewsOwnEvidence = compileFourPlanIndependentCertificate({
  ...base,
  reviewers: [
    { ...base.reviewers[0], outputPath: 'docs/reports/objectives.json' },
    base.reviewers[1]
  ]
});
assert.ok(reviewsOwnEvidence.diagnostics.includes('reviewer-output-is-certified-evidence:reviewer-a'));

const noInputs = compileFourPlanIndependentCertificate({
  ...base,
  reviewers: [{ ...base.reviewers[0], inputPaths: [], inputDigests: [] }, base.reviewers[1]]
});
assert.ok(noInputs.diagnostics.includes('reviewer-input-digests-missing:reviewer-a'));
assert.ok(noInputs.diagnostics.includes('reviewer-input-paths-missing:reviewer-a'));

const mismatchedInputs = compileFourPlanIndependentCertificate({
  ...base,
  reviewers: [{ ...base.reviewers[0], inputDigests: [evidenceDigests['docs/reports/cards.json']] }, base.reviewers[1]]
});
assert.ok(mismatchedInputs.diagnostics.includes('reviewer-input-digests-unreproducible:reviewer-a'));

const copiedItsOwnOutput = compileFourPlanIndependentCertificate({
  ...base,
  reviewers: [
    { ...base.reviewers[0], inputDigests: [base.reviewers[0].digest] },
    base.reviewers[1]
  ]
});
assert.ok(copiedItsOwnOutput.diagnostics.includes('reviewer-input-equals-output:reviewer-a'));

const writerAsReviewer = compileFourPlanIndependentCertificate({
  ...base,
  reviewers: [{ ...base.reviewers[0], roles: ['certificate-writer'] }]
});
assert.equal(writerAsReviewer.status, 'contradictory');
assert.ok(writerAsReviewer.diagnostics.some((entry) => entry.startsWith('reviewer-role-not-independent:reviewer-a')));

// test_atm_gov_0360_evidence_freshness_is_observed_not_declared
const unobserved = compileFourPlanIndependentCertificate({
  ...base,
  evidenceObservations: base.evidenceObservations.filter((entry) => entry.path !== 'docs/reports/charter.json')
});
assert.ok(unobserved.diagnostics.includes('evidence-observation-missing:docs/reports/charter.json'));

const deleted = compileFourPlanIndependentCertificate({
  ...base,
  evidenceObservations: base.evidenceObservations.map((entry) =>
    entry.path === 'docs/reports/charter.json' ? { ...entry, present: false, digest: '' } : entry
  )
});
assert.ok(deleted.diagnostics.includes('evidence-unreadable:docs/reports/charter.json'));

const movedOn = compileFourPlanIndependentCertificate({
  ...base,
  evidenceObservations: base.evidenceObservations.map((entry) =>
    entry.path === 'docs/reports/charter.json' ? { ...entry, reachableFromTargetHead: false } : entry
  )
});
assert.ok(movedOn.diagnostics.includes('evidence-newer-than-certificate:docs/reports/charter.json'));
assert.equal(movedOn.overallVerdict, 'not-complete');

const uncommitted = compileFourPlanIndependentCertificate({
  ...base,
  evidenceObservations: base.evidenceObservations.map((entry) =>
    entry.path === 'docs/reports/charter.json' ? { ...entry, dirty: true } : entry
  )
});
assert.ok(uncommitted.diagnostics.includes('evidence-uncommitted:docs/reports/charter.json'));

const driftedEvidence = compileFourPlanIndependentCertificate({
  ...base,
  evidenceObservations: base.evidenceObservations.map((entry) =>
    entry.path === 'docs/reports/charter.json' ? { ...entry, digest: hex('e') } : entry
  )
});
assert.ok(
  driftedEvidence.diagnostics.includes('dimension-digest-unreproducible:charter-verdict'),
  `a dimension digest that no longer follows from its evidence is stale; observed: ${driftedEvidence.diagnostics.join(', ')}`
);

// A dimension that summarises several artifacts may use the composite digest.
const compositeRefs = ['docs/reports/objectives.json', 'docs/reports/cards.json'];
const composite = compileFourPlanIndependentCertificate({
  ...base,
  dimensions: [
    {
      dimensionId: 'objective-verdict',
      status: 'proven' as const,
      digest: composeEvidenceDigest(compositeRefs.map((path) => ({ path, digest: evidenceDigests[path] }))),
      evidenceRefs: compositeRefs
    },
    ...base.dimensions.slice(1)
  ]
});
assert.deepEqual(composite.diagnostics, []);

// test_atm_gov_0360_release_verdict_uses_live_remote
const missingRemoteSurface = compileFourPlanIndependentCertificate({
  ...base,
  releaseSurfaces: base.releaseSurfaces.filter((surface) => surface.surfaceId !== 'origin-main')
});
assert.ok(missingRemoteSurface.diagnostics.includes('release-surface-required-missing:origin-main'));

const remoteMovedOn = compileFourPlanIndependentCertificate({
  ...base,
  releaseSurfaces: base.releaseSurfaces.map((surface) =>
    surface.surfaceId === 'origin-main' ? { ...surface, observedDigest: commit('c') } : surface
  )
});
assert.equal(remoteMovedOn.status, 'stale');
assert.equal(remoteMovedOn.overallVerdict, 'not-complete');
assert.equal(remoteMovedOn.releaseAuthorized, false);
assert.ok(remoteMovedOn.diagnostics.includes('release-digest-mismatch:origin-main'));
assert.ok(remoteMovedOn.nonClaims.includes('does-not-authorize-release:origin-main'));

const notACommit = compileFourPlanIndependentCertificate({
  ...base,
  releaseSurfaces: base.releaseSurfaces.map((surface) =>
    surface.surfaceId === 'target-head' ? { ...surface, expectedDigest: 'HEAD', observedDigest: 'HEAD' } : surface
  )
});
assert.ok(notACommit.diagnostics.includes('release-surface-commit-malformed:target-head'));

const blocked = compileFourPlanIndependentCertificate({
  ...base,
  dimensions: [
    ...base.dimensions,
    { dimensionId: 'release-verdict', status: 'unknown' as const, digest: hex('d'), evidenceRefs: ['docs/reports/release.json'] }
  ],
  evidenceObservations: [...base.evidenceObservations, { ...observation('docs/reports/release.json'), digest: hex('d') }]
});
assert.equal(blocked.overallVerdict, 'not-complete');
assert.equal(blocked.releaseAuthorized, false);
assert.ok(blocked.diagnostics.includes('dimension-fail-closed:release-verdict:unknown'));
assert.ok(blocked.nonClaims.includes('does-not-claim-complete:release-verdict'));

// A hand-edited verdict is caught even when the diagnostics list is left empty.
assert.equal(validateFourPlanIndependentCertificate({ ...proven, status: 'blocked' as const }).ok, false);
assert.ok(
  validateFourPlanIndependentCertificate({ ...remoteMovedOn, status: 'proven' as const, overallVerdict: 'complete', releaseAuthorized: true })
    .diagnostics.includes('certificate-verdict-inconsistent')
);

// The committed certificate: assert that it is internally honest and bound to
// the remote as it is right now, not that it says complete.
const report = JSON.parse(readFileSync('docs/reports/plan-3x-4x-independent-certificate.json', 'utf8'));
assert.equal(validateSchema(report), true, JSON.stringify(validateSchema.errors));
const reportVerdict = validateFourPlanIndependentCertificate(report);
assert.equal(
  reportVerdict.diagnostics.includes('certificate-digest-mismatch'),
  false,
  'the committed certificate must be signed over its own content'
);
assert.equal(reportVerdict.diagnostics.includes('certificate-verdict-inconsistent'), false);
assert.equal(reportVerdict.diagnostics.includes('certificate-release-authorization-inconsistent'), false);
assert.equal(report.overallVerdict, report.status === 'proven' ? 'complete' : 'not-complete');
assert.equal(report.releaseAuthorized, report.status === 'proven');
assert.equal(report.releaseAuthorized, report.diagnostics.length === 0);

const liveOriginMain = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/main'], { encoding: 'utf8' }).trim().split(/\s+/)[0];
assert.match(String(liveOriginMain), /^[0-9a-f]{40}$/, 'the remote must be reachable to judge certificate freshness');
const recordedOriginMain = String(report.provenance.originMain);
assert.match(recordedOriginMain, /^[0-9a-f]{40}$/, 'the certificate must record the remote SHA it was compiled against');
const remoteSurface = report.releaseSurfaces.find((entry: any) => entry.surfaceId === 'origin-main');
assert.equal(remoteSurface?.observedDigest, recordedOriginMain, 'the remote surface and the provenance must describe the same observation');

// A certificate can only authorize the remote it was compiled against. Once the
// remote moves past it, the commits beyond it are uncertified, so claiming
// complete would be authorizing code this certificate never saw. Refreshing it
// is scripts/compile-four-plan-independent-certificate.ts --mode write.
if (recordedOriginMain !== liveOriginMain) {
  assert.equal(
    report.overallVerdict,
    'not-complete',
    `certificate is bound to ${recordedOriginMain} but origin/main is ${liveOriginMain}; a superseded certificate must not claim complete`
  );
  assert.equal(report.releaseAuthorized, false);
}

console.log('four-plan-independent-certificate.test.ts: ok');

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  compileFourPlanIndependentCertificate,
  validateFourPlanIndependentCertificate
} from '../../packages/core/src/evidence/four-plan-independent-certificate.ts';

const base = {
  certificateId: 'cert-0341',
  generatedAt: '2026-08-12T00:00:00.000Z',
  writerRole: 'certificate-writer',
  reviewers: [
    { reviewerId: 'reviewer-a', roles: ['independent-reviewer'], outputPath: 'docs/reports/reviewer-a.json', digest: 'sha256:a' },
    { reviewerId: 'reviewer-b', roles: ['independent-reviewer'], outputPath: 'docs/reports/reviewer-b.json', digest: 'sha256:b' }
  ],
  minimumIndependentReviewers: 2,
  forbiddenReviewerRoles: ['certificate-writer', 'fixture-generator', 'implementer', 'evidence-producer', 'closure-actor', 'override-approver'],
  dimensions: [
    { dimensionId: 'objective-verdict', status: 'proven' as const, digest: 'sha256:o', evidenceRefs: ['docs/reports/objectives.json'] },
    { dimensionId: 'card-state-verdict', status: 'proven' as const, digest: 'sha256:c', evidenceRefs: ['docs/reports/cards.json'] },
    { dimensionId: 'incident-verdict', status: 'proven' as const, digest: 'sha256:i', evidenceRefs: ['docs/reports/incidents.json'] },
    { dimensionId: 'freshness-verdict', status: 'proven' as const, digest: 'sha256:f', evidenceRefs: ['docs/reports/freshness.json'] },
    { dimensionId: 'charter-verdict', status: 'proven' as const, digest: 'sha256:h', evidenceRefs: ['docs/reports/charter.json'] }
  ],
  releaseSurfaces: [
    { surfaceId: 'source', expectedDigest: 'sha256:s', observedDigest: 'sha256:s', reachable: true },
    { surfaceId: 'frozen-runner', expectedDigest: 'sha256:r', observedDigest: 'sha256:r', reachable: true },
    { surfaceId: 'root-drop', expectedDigest: 'sha256:d', observedDigest: 'sha256:d', reachable: true },
    { surfaceId: 'onefile', expectedDigest: 'sha256:m', observedDigest: 'sha256:m', reachable: true }
  ],
  mutationControls: ['byte-stable-digest', 'fail-closed-verdict'],
  provenance: { taskId: 'ATM-GOV-0341' }
};

const proven = compileFourPlanIndependentCertificate(base);
assert.equal(proven.schemaId, 'atm.fourPlanIndependentCertificate.v1');
assert.equal(proven.status, 'proven');
assert.equal(proven.overallVerdict, 'complete');
assert.equal(proven.releaseAuthorized, true);
assert.deepEqual(validateFourPlanIndependentCertificate(proven), { ok: true, diagnostics: [] });

const schema = JSON.parse(readFileSync('schemas/evidence/four-plan-independent-certificate.schema.json', 'utf8'));
const validateSchema = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
assert.equal(validateSchema(proven), true, JSON.stringify(validateSchema.errors));

const blocked = compileFourPlanIndependentCertificate({
  ...base,
  dimensions: [
    ...base.dimensions,
    { dimensionId: 'release-verdict', status: 'unknown' as const, digest: 'sha256:u', evidenceRefs: ['docs/reports/release.json'] }
  ],
  releaseSurfaces: [
    ...base.releaseSurfaces,
    { surfaceId: 'remote', expectedDigest: 'sha256:x', observedDigest: 'sha256:y', reachable: true }
  ]
});
assert.equal(blocked.overallVerdict, 'not-complete');
assert.equal(blocked.releaseAuthorized, false);
assert.ok(blocked.diagnostics.includes('dimension-fail-closed:release-verdict:unknown'));
assert.ok(blocked.diagnostics.includes('release-digest-mismatch:remote'));
assert.ok(blocked.nonClaims.includes('does-not-claim-complete:release-verdict'));

const nonIndependent = compileFourPlanIndependentCertificate({
  ...base,
  reviewers: [
    { reviewerId: 'writer-reviewer', roles: ['certificate-writer'], outputPath: 'docs/reports/writer.json', digest: 'sha256:w' }
  ]
});
assert.equal(nonIndependent.status, 'contradictory');
assert.ok(nonIndependent.diagnostics.some((entry) => entry.startsWith('reviewer-role-not-independent:writer-reviewer')));

const tampered = { ...proven, status: 'blocked' as const };
assert.equal(validateFourPlanIndependentCertificate(tampered).ok, false);

const report = JSON.parse(readFileSync('docs/reports/plan-3x-4x-independent-certificate.json', 'utf8'));
assert.equal(validateSchema(report), true, JSON.stringify(validateSchema.errors));
assert.equal(validateFourPlanIndependentCertificate(report).diagnostics.includes('certificate-digest-mismatch'), false);
assert.equal(report.overallVerdict, 'not-complete');
assert.equal(report.releaseAuthorized, false);
assert.ok(report.diagnostics.includes('dimension-fail-closed:objective-verdict:not-complete'));
assert.equal(report.diagnostics.includes('dimension-fail-closed:charter-verdict:not-complete'), false);
assert.equal(report.diagnostics.includes('release-digest-mismatch:origin-main'), false);

const closeback = JSON.parse(readFileSync('docs/reports/plan-3x-4x-release-closeback.json', 'utf8'));
const targetHead = String(closeback.targetHead);
const recordedOriginMain = String(closeback.originMain);
assert.equal(targetHead.length, 40);
assert.equal(recordedOriginMain, targetHead);
execFileSync('git', ['merge-base', '--is-ancestor', targetHead, 'origin/main'], { stdio: 'ignore' });
assert.equal(closeback.status, 'pushed');
assert.equal(closeback.legacyAuthority.retired, false);
assert.equal(closeback.remoteReachability.targetHeadReachableFromOriginMain, true);
console.log('four-plan-independent-certificate.test.ts: ok');

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createQualityCertificate,
  QUALITY_CERTIFICATE_SCHEMA_ID,
  summarizeQualityCertificate,
  validateQualityCertificate
} from '../../packages/core/src/evidence/coverage-semantics.ts';
import { loadLegacyCaseAliases, resolveLegacyCaseId } from '../../packages/core/src/evidence/test-case-catalog.ts';

const certificate = createQualityCertificate({
  certificateId: 'cert-plan4-foundation',
  issuedAt: '2026-07-31T00:00:00.000Z',
  model: {
    modelId: 'atm.plan4.foundation',
    version: '0.1.0',
    digest: 'sha256:model'
  },
  claimKind: 'finite-model-proven',
  coverageRatio: 1,
  obligationSummary: [
    { status: 'proven', count: 4 },
    { status: 'excluded', count: 1 }
  ],
  assumptions: [{ id: 'finite-model', statement: 'The claim is bounded to the named Plan 4.0 foundation model.' }],
  exclusions: [{ id: 'open-world-runtime', reason: 'Runtime behavior outside the declared model is not claimed.' }],
  evidenceRefs: ['tests/cli/plan4-coverage-semantics.test.ts']
});

assert.equal(certificate.schemaId, QUALITY_CERTIFICATE_SCHEMA_ID);
assert.equal(certificate.modelRelative, true);
assert.equal(validateQualityCertificate(certificate).ok, true);

const summary = summarizeQualityCertificate(certificate);
assert.deepEqual(summary, {
  certificateId: 'cert-plan4-foundation',
  modelId: 'atm.plan4.foundation',
  claimKind: 'finite-model-proven',
  coverageRatio: 1,
  provenCount: 4,
  gapCount: 0,
  unsupportedCount: 0,
  assumptionCount: 1,
  exclusionCount: 1,
  modelRelative: true
});

const unqualifiedHundred = createQualityCertificate({
  certificateId: 'cert-bad-absolute',
  issuedAt: '2026-07-31T00:00:00.000Z',
  model: { modelId: 'atm.plan4.foundation' },
  claimKind: 'finite-model-proven',
  coverageRatio: 1,
  obligationSummary: [{ status: 'proven', count: 1 }]
});
const unqualifiedResult = validateQualityCertificate(unqualifiedHundred);
assert.equal(unqualifiedResult.ok, false);
assert.ok(
  unqualifiedResult.diagnostics.some((entry) => entry.code === 'ATM_QUALITY_CERTIFICATE_UNQUALIFIED_100'),
  'unqualified 100% claims must be diagnosed instead of accepted as absolute truth'
);

const sufficient = createQualityCertificate({
  certificateId: 'cert-sufficient',
  issuedAt: '2026-07-31T00:00:00.000Z',
  model: { modelId: 'atm.plan4.foundation', digest: 'sha256:model' },
  claimKind: 'sufficient-under-assumptions',
  coverageRatio: 0.9,
  obligationSummary: [
    { status: 'sufficient-under-assumptions', count: 9 },
    { status: 'unknown', count: 1 }
  ],
  assumptions: [{ id: 'human-reviewed-gap', statement: 'The remaining unknown is accepted by a human review gate.' }]
});
assert.equal(validateQualityCertificate(sufficient).ok, true);
assert.equal(summarizeQualityCertificate(sufficient).gapCount, 1);

const unsupported = createQualityCertificate({
  certificateId: 'cert-unsupported',
  issuedAt: '2026-07-31T00:00:00.000Z',
  model: { modelId: 'atm.plan4.foundation', digest: 'sha256:model' },
  claimKind: 'unsupported',
  coverageRatio: 0,
  obligationSummary: [{ status: 'unsupported', count: 2 }]
});
assert.equal(validateQualityCertificate(unsupported).ok, true);
assert.equal(summarizeQualityCertificate(unsupported).unsupportedCount, 2);

const schema = JSON.parse(readFileSync('schemas/evidence/quality-certificate.schema.json', 'utf8'));
assert.equal(schema.properties.schemaId.const, QUALITY_CERTIFICATE_SCHEMA_ID);
assert.ok(schema.required.includes('modelRelative'));
assert.ok(schema.properties.claimKind.enum.includes('sufficient-under-assumptions'));
assert.ok(schema.properties.obligationSummary.items.properties.status.enum.includes('unsupported'));

const shard = JSON.parse(readFileSync('tests/catalog/groups/test_group_plan4_coverage_semantics.shard.json', 'utf8'));
// This suite is named by a closed card under its pre-migration id. Resolving
// that id through the shard's legacyAliases lineage keeps both facts asserted:
// the old reference still resolves, and the canonical case is really there.
const legacyCaseId = 'test_atm_gov_0277_model_relative_certificate_vocabulary_0d0fd68c';
const canonicalCaseId = resolveLegacyCaseId(legacyCaseId, loadLegacyCaseAliases(process.cwd()));
assert.ok(canonicalCaseId, 'the pre-migration case id must stay resolvable through legacyAliases');
const testCase = shard.cases.find((entry: { caseId?: string }) => entry.caseId === canonicalCaseId);
assert.ok(testCase, 'catalog shard must include the task-required Plan 4.0 coverage semantics case');
assert.ok(testCase.coversAcceptance.includes('ACC-5'));

console.log(JSON.stringify({
  marker: '[plan4-coverage-semantics:test] ok',
  schemaId: certificate.schemaId,
  rejectedUnqualifiedHundred: true
}));

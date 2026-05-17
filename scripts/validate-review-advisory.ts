import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  appendMachineFindings,
  checkPromotionSafetyGates,
  createConversationPatchDraftAdvisoryReport,
  createStubReviewAdvisoryReport,
  createUnavailableAdvisoryReport,
  mapConversationPatchDraftsToMachineFindings,
  normalizeProviderPayload
} from '../packages/plugin-review-advisory/src/index.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function check(condition: any, message: any) {
  if (!condition) {
    throw new Error(`[review-advisory:${mode}] ${message}`);
  }
}

function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

for (const relativePath of [
  'packages/plugin-review-advisory/package.json',
  'packages/plugin-review-advisory/src/index.ts',
  'packages/plugin-review-advisory/src/promotion-gates.ts',
  'packages/cli/src/commands/review-advisory.ts',
  'schemas/review-advisory/review-advisory-report.schema.json',
  'fixtures/review-advisory/stub-pass.json',
  'fixtures/review-advisory/stub-warn.json',
  'fixtures/review-advisory/malformed-provider-response.json',
  'fixtures/review-advisory/no-provider-dry-run.json',
  'fixtures/review-advisory/conversation-machine-findings.json',
  'fixtures/review-advisory/conversation-missing-refs-blocked.json',
  'fixtures/review-advisory/conversation-privacy-gate.json',
  'fixtures/review-advisory/conversation-single-user-downgrade.json',
  'fixtures/review-advisory/conversation-stale-skill-repair-blocked.json',
  'fixtures/evolution/conversation-skill-review/patch-draft-bridge/four-findings-patch-drafts.json',
  'fixtures/upgrade/stale-proposal.json',
  'fixtures/upgrade/downgrade-preference-proposal.json',
  'fixtures/upgrade/breaking-proposal.json',
  'fixtures/upgrade/redaction-blocked-proposal.json'
]) {
  check(existsSync(path.join(root, relativePath)), `missing required file: ${relativePath}`);
}

const schema = readJson('schemas/review-advisory/review-advisory-report.schema.json');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateReport = ajv.compile(schema);

const stubPass = readJson('fixtures/review-advisory/stub-pass.json');
check(validateReport(stubPass) === true, `stub-pass fixture schema validation failed: ${JSON.stringify(validateReport.errors)}`);

const stubWarn = readJson('fixtures/review-advisory/stub-warn.json');
check(validateReport(stubWarn) === true, `stub-warn fixture schema validation failed: ${JSON.stringify(validateReport.errors)}`);
check(stubWarn.needsReview === true, 'stub-warn fixture must mark needsReview=true');

const malformed = readJson('fixtures/review-advisory/malformed-provider-response.json');
const malformedNormalized = normalizeProviderPayload(malformed, {
  reportId: 'review-advisory.malformed',
  provider: {
    mode: 'external-cli',
    providerId: 'external-cli-provider',
    providerVersion: '1.0.0',
    transport: 'child-process'
  },
  target: {
    kind: 'scope',
    id: 'malformed-provider-response'
  }
});
check(malformedNormalized.ok === false, 'malformed provider response must not normalize as ok');
check(malformedNormalized.report.advisoryUnavailable === true, 'malformed provider response must degrade to advisory-unavailable');
check(validateReport(malformedNormalized.report) === true, `normalized malformed report schema validation failed: ${JSON.stringify(validateReport.errors)}`);

const unavailableFixture = readJson('fixtures/review-advisory/no-provider-dry-run.json');
check(validateReport(unavailableFixture) === true, `no-provider-dry-run fixture schema validation failed: ${JSON.stringify(validateReport.errors)}`);
check(unavailableFixture.status === 'advisory-unavailable', 'no-provider-dry-run status must be advisory-unavailable');
check(unavailableFixture.needsReview === true, 'no-provider-dry-run must mark needsReview=true');

const unavailableReport = createUnavailableAdvisoryReport({
  reportId: 'review-advisory.provider-missing',
  provider: {
    mode: 'agent-bridge',
    providerId: 'agent-bridge-provider',
    providerVersion: '1.0.0',
    transport: 'json-file'
  },
  target: {
    kind: 'scope',
    id: 'dry-run'
  },
  reason: 'provider-missing'
});
check(validateReport(unavailableReport) === true, `createUnavailableAdvisoryReport must emit schema-valid output: ${JSON.stringify(validateReport.errors)}`);
check(unavailableReport.needsReview === true, 'unavailable advisory must route to needsReview=true');

const stubPassGenerated = createStubReviewAdvisoryReport({
  profile: 'pass',
  reportId: 'review-advisory.stub.pass.generated',
  target: {
    kind: 'proposal',
    id: 'proposal.sample'
  }
});
check(validateReport(stubPassGenerated) === true, `createStubReviewAdvisoryReport(pass) must emit schema-valid output: ${JSON.stringify(validateReport.errors)}`);

const mergedWithMachineFindings = appendMachineFindings(stubPassGenerated, [
  {
    id: 'machine.high-risk.delta',
    severity: 'high',
    message: 'Machine finding indicates high-risk behavior delta.',
    routeHint: 'human-review.required',
    evidenceRef: 'machine.finding.delta'
  }
]);
check(validateReport(mergedWithMachineFindings) === true, `appendMachineFindings output schema validation failed: ${JSON.stringify(validateReport.errors)}`);
check(mergedWithMachineFindings.status === 'warn', 'high severity machine finding must escalate report status to warn');
check(mergedWithMachineFindings.needsReview === true, 'machine finding merge must keep needsReview=true when severity is high');

const conversationAdvisoryFixturePaths = [
  'fixtures/review-advisory/conversation-machine-findings.json',
  'fixtures/review-advisory/conversation-missing-refs-blocked.json',
  'fixtures/review-advisory/conversation-privacy-gate.json',
  'fixtures/review-advisory/conversation-single-user-downgrade.json',
  'fixtures/review-advisory/conversation-stale-skill-repair-blocked.json'
];

for (const fixturePath of conversationAdvisoryFixturePaths) {
  const fixture = readJson(fixturePath);
  const patchDraftReport = resolveConversationPatchDraftReport(fixture.input);
  const machineFindings = mapConversationPatchDraftsToMachineFindings(patchDraftReport);
  check(machineFindings.length >= 1, `${fixturePath} must produce at least one conversation machine finding`);
  check(machineFindings.every((finding: any) => finding.trigger === 'machine-finding'), `${fixturePath} findings must enter ReviewAdvisory as machine findings`);

  const advisoryReport = createConversationPatchDraftAdvisoryReport({
    reportId: fixture.input.reportId,
    patchDraftReport,
    generatedAt: fixture.input.generatedAt
  });
  check(validateReport(advisoryReport) === true, `${fixturePath} conversation advisory report schema validation failed: ${JSON.stringify(validateReport.errors)}`);
  check(advisoryReport.status === fixture.expected.status, `${fixturePath} status mismatch`);
  check(advisoryReport.needsReview === fixture.expected.needsReview, `${fixturePath} needsReview mismatch`);

  if (fixture.expected.summary) {
    check(JSON.stringify(advisoryReport.summary) === JSON.stringify(fixture.expected.summary), `${fixturePath} summary mismatch`);
  }

  if (fixture.expected.routeHints) {
    for (const routeHint of fixture.expected.routeHints) {
      check(advisoryReport.findings.some((finding: any) => finding.routeHint === routeHint), `${fixturePath} missing routeHint ${routeHint}`);
    }
  }

  if (fixture.expected.blockedRouteHints) {
    for (const routeHint of fixture.expected.blockedRouteHints) {
      const finding = advisoryReport.findings.find((candidate: any) => candidate.routeHint === routeHint);
      check(finding !== undefined, `${fixturePath} missing blocked routeHint ${routeHint}`);
      check((finding as any).severity === 'high', `${fixturePath} ${routeHint} must be high severity`);
      check((finding as any).action === 'request-human-review', `${fixturePath} ${routeHint} must request human review`);
    }
  }
}

console.log('[review-advisory:' + mode + '] ok (provider modes, fallback behavior, machine-finding ingest, conversation machine findings, and schema fixtures verified)');

// ── M4: Promotion Safety Gates ────────────────────────────────────────────────

// Gate 1: baseAtomVersion mismatch blocks promotion
const staleProposalFixture = readJson('fixtures/upgrade/stale-proposal.json');
const staleMismatchResult = checkPromotionSafetyGates(staleProposalFixture, {
  currentAtomVersion: '1.2.0' // stale-proposal has baseAtomVersion 1.1.0 → mismatch
});
check(staleMismatchResult.passed === false, 'Gate 1: baseAtomVersion mismatch must block promotion');
check(staleMismatchResult.blockedGates.includes('baseAtomVersionMismatch'), 'Gate 1: blockedGates must contain baseAtomVersionMismatch');
check(staleMismatchResult.findings.some((f) => f.gate === 'baseAtomVersionMismatch' && f.blocked), 'Gate 1: findings must have blocked=true for baseAtomVersionMismatch');

// Gate 1 pass: versions match
const stalePassResult = checkPromotionSafetyGates(staleProposalFixture, {
  currentAtomVersion: '1.1.0' // matches baseAtomVersion 1.1.0
});
check(
  !stalePassResult.blockedGates.includes('baseAtomVersionMismatch'),
  'Gate 1: matching versions must not block baseAtomVersionMismatch gate'
);

// Gate 2: stale evidence watermark blocks promotion
const staleWatermarkResult = checkPromotionSafetyGates(staleProposalFixture, {
  isEvidenceWatermarkStale: true
});
check(staleWatermarkResult.passed === false, 'Gate 2: stale evidence watermark must block promotion');
check(staleWatermarkResult.blockedGates.includes('staleEvidenceWatermark'), 'Gate 2: blockedGates must contain staleEvidenceWatermark');

// Gate 2 pass: watermark is current
const freshWatermarkResult = checkPromotionSafetyGates(staleProposalFixture, {
  isEvidenceWatermarkStale: false
});
check(
  !freshWatermarkResult.blockedGates.includes('staleEvidenceWatermark'),
  'Gate 2: current watermark must not block staleEvidenceWatermark gate'
);

// Gate 3: single-user preference cannot auto-promote to atom-spec
const downgradeFixture = readJson('fixtures/upgrade/downgrade-preference-proposal.json');
const downgradeResult = checkPromotionSafetyGates(downgradeFixture, {
  evidenceScopeIsUserLocal: true
});
check(downgradeResult.passed === false, 'Gate 3: single-user evidence targeting atom-spec must block promotion');
check(downgradeResult.blockedGates.includes('targetSurfaceDowngrade'), 'Gate 3: blockedGates must contain targetSurfaceDowngrade');
check(downgradeResult.findings.some((f) => f.gate === 'targetSurfaceDowngrade' && f.blocked), 'Gate 3: findings must have blocked=true for targetSurfaceDowngrade');

// Gate 3 pass: evidence scope is broader than single user
const downgradePassResult = checkPromotionSafetyGates(downgradeFixture, {
  evidenceScopeIsUserLocal: false
});
check(
  !downgradePassResult.blockedGates.includes('targetSurfaceDowngrade'),
  'Gate 3: cross-user evidence must not block targetSurfaceDowngrade gate'
);

// Gate 4: breaking proposals must route to human review
const breakingFixture = readJson('fixtures/upgrade/breaking-proposal.json');
const breakingResult = checkPromotionSafetyGates(breakingFixture, {});
check(breakingResult.passed === false, 'Gate 4: breaking proposal must block promotion until human review');
check(breakingResult.blockedGates.includes('breakingHumanReview'), 'Gate 4: blockedGates must contain breakingHumanReview');
check(breakingResult.findings.some((f) => f.gate === 'breakingHumanReview' && f.blocked), 'Gate 4: findings must have blocked=true for breakingHumanReview');

// Gate 4 pass: rollback-safe proposal does not trigger this gate
const nonBreakingProposal = { ...breakingFixture, reversibility: 'rollback-safe' };
const nonBreakingResult = checkPromotionSafetyGates(nonBreakingProposal, {});
check(
  !nonBreakingResult.blockedGates.includes('breakingHumanReview'),
  'Gate 4: rollback-safe proposal must not block breakingHumanReview gate'
);

// Gate 5: missing redaction report blocks promotion
const redactionFixture = readJson('fixtures/upgrade/redaction-blocked-proposal.json');
const redactionResult = checkPromotionSafetyGates(redactionFixture, {
  hasRedactionReport: false
});
check(redactionResult.passed === false, 'Gate 5: missing redaction report must block promotion');
check(redactionResult.blockedGates.includes('missingRedactionReport'), 'Gate 5: blockedGates must contain missingRedactionReport');

// Gate 5 pass: redaction report is present in context
const redactionPassResult = checkPromotionSafetyGates(redactionFixture, {
  hasRedactionReport: true
});
check(
  !redactionPassResult.blockedGates.includes('missingRedactionReport'),
  'Gate 5: proposal with redaction report must not block missingRedactionReport gate'
);

// Gate 5 pass: redaction-report input reference provided in proposal
const proposalWithRedactionInput = {
  ...redactionFixture,
  inputs: [
    ...(redactionFixture.inputs ?? []),
    { kind: 'redaction-report', path: 'fixtures/upgrade/redaction-blocked-proposal.json', schemaId: 'atm.redactionReport' }
  ]
};
const redactionInputPassResult = checkPromotionSafetyGates(proposalWithRedactionInput, {
  hasRedactionReport: false // context says false, but input ref overrides
});
check(
  !redactionInputPassResult.blockedGates.includes('missingRedactionReport'),
  'Gate 5: redaction-report input reference must satisfy the missing-redaction-report gate'
);

console.log('[review-advisory:' + mode + '] ok (M4 promotion safety gates: all 5 gates verified — baseAtomVersionMismatch, staleEvidenceWatermark, targetSurfaceDowngrade, breakingHumanReview, missingRedactionReport)');

function resolveConversationPatchDraftReport(inputFixture: any) {
  if (inputFixture.patchDraftReport) {
    return inputFixture.patchDraftReport;
  }
  if (inputFixture.patchDraftFixturePath) {
    const patchFixture = readJson(inputFixture.patchDraftFixturePath);
    return patchFixture.expectedReport;
  }
  throw new Error('conversation advisory fixture must provide patchDraftReport or patchDraftFixturePath');
}

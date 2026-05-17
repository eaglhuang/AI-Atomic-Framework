import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { conversationReviewFindingKinds, type ConversationReviewFindingsReport } from '../packages/plugin-sdk/src/conversation/conversation-review-finding.ts';
import {
  draftConversationPatches,
  type ConversationPatchDraftBridgeInput,
  type ConversationPatchDraftReport
} from '../packages/plugin-sdk/src/conversation/conversation-patch-draft-bridge.ts';
import {
  reviewConversationTranscript,
  type ConversationTranscriptReviewInput
} from '../packages/plugin-sdk/src/conversation/conversation-transcript-reviewer.ts';
import { createValidator } from './lib/validator-harness.ts';
import type { AnySchema } from 'ajv';

const validator = createValidator('conversation-skill-review');
const { createAjv, readJson, repoPath, assert: check, ok } = validator;

const schema = readJson<AnySchema>('schemas/governance/conversation-review-findings-report.schema.json');
const transcriptSchema = readJson<AnySchema>('schemas/governance/conversation-transcript.schema.json');
const patchDraftSchema = readJson<AnySchema>('schemas/governance/conversation-patch-draft-report.schema.json');
const upgradeProposalSchema = readJson<AnySchema>('schemas/upgrade/upgrade-proposal.schema.json');
const ajv = createAjv();
ajv.addSchema(upgradeProposalSchema);
const validateReport = ajv.compile(schema);
const validateTranscript = ajv.compile(transcriptSchema);
const validatePatchDraftReport = ajv.compile(patchDraftSchema);
const validateUpgradeProposal = ajv.getSchema('https://schemas.ai-atomic-framework.dev/upgrade/upgrade-proposal.schema.json');
check(validateUpgradeProposal !== undefined, 'upgrade proposal schema must be registered for patch draft validation');
const fixtureRoot = repoPath('fixtures', 'evolution', 'conversation-skill-review');
const fixtureFiles = readdirSync(fixtureRoot)
  .filter((entry) => entry.endsWith('.json'))
  .sort();
const transcriptFixtureRoot = repoPath('fixtures', 'evolution', 'conversation-skill-review', 'transcript-reviewer');
const transcriptFixtureFiles = existsSync(transcriptFixtureRoot)
  ? readdirSync(transcriptFixtureRoot).filter((entry) => entry.endsWith('.json')).sort()
  : [];
const patchDraftFixtureRoot = repoPath('fixtures', 'evolution', 'conversation-skill-review', 'patch-draft-bridge');
const patchDraftFixtureFiles = existsSync(patchDraftFixtureRoot)
  ? readdirSync(patchDraftFixtureRoot).filter((entry) => entry.endsWith('.json')).sort()
  : [];

check(fixtureFiles.length >= 1, 'expected conversation skill review fixtures');
check(transcriptFixtureFiles.length >= 1, 'expected conversation transcript reviewer fixtures');
check(patchDraftFixtureFiles.length >= 1, 'expected conversation patch draft bridge fixtures');

type TranscriptReviewFixture = {
  readonly description?: string;
  readonly input: ConversationTranscriptReviewInput;
  readonly expectedReport: ConversationReviewFindingsReport;
};

type PatchDraftBridgeFixture = {
  readonly description?: string;
  readonly input: Omit<ConversationPatchDraftBridgeInput, 'findingsReport'> & {
    readonly findingsReport?: ConversationReviewFindingsReport;
    readonly findingsReportPath?: string;
  };
  readonly expectedReport: ConversationPatchDraftReport;
};

const seenKinds = new Set<string>();
let validatedReports = 0;
let validatedFindings = 0;

for (const fixtureFile of fixtureFiles) {
  const relativePath = path.join('fixtures', 'evolution', 'conversation-skill-review', fixtureFile).replace(/\\/g, '/');
  const report = readJson<ConversationReviewFindingsReport>(relativePath);
  check(validateReport(report) === true, `${fixtureFile} failed schema validation: ${JSON.stringify(validateReport.errors)}`);
  check(report.draftOnly.appliesAutomatically === false, `${fixtureFile} must not apply findings automatically`);
  check(report.draftOnly.mutatesRegistry === false, `${fixtureFile} must not mutate registry`);
  check(report.draftOnly.mutatesSkillFiles === false, `${fixtureFile} must not mutate skill files`);
  check(report.draftOnly.requiresHumanReview === true, `${fixtureFile} must require human review`);

  if (report.privacy.containsSensitiveInput) {
    check(report.privacy.redactionReportPaths.length > 0, `${fixtureFile} sensitive transcript must include redaction report paths`);
  }

  const reportKinds = new Set(report.findings.map((finding) => finding.findingKind));
  check(report.summary.totalFindings === report.findings.length, `${fixtureFile} summary.totalFindings must match findings length`);
  check(report.summary.findingKinds.length === reportKinds.size, `${fixtureFile} summary.findingKinds must be unique and complete`);
  for (const findingKind of reportKinds) {
    check(report.summary.findingKinds.includes(findingKind), `${fixtureFile} summary.findingKinds missing ${findingKind}`);
    seenKinds.add(findingKind);
  }

  const draftCount = report.findings.filter((finding) => finding.recommendation !== 'observation-only').length;
  const observationCount = report.findings.length - draftCount;
  check(report.summary.draftCount === draftCount, `${fixtureFile} summary.draftCount must match non-observation findings`);
  check(report.summary.observationCount === observationCount, `${fixtureFile} summary.observationCount must match observation-only findings`);

  for (const finding of report.findings) {
    check(finding.evidenceRefs.length > 0, `${fixtureFile} ${finding.findingId} must cite evidence refs`);
    check(finding.sourceTranscriptRefs.length > 0, `${fixtureFile} ${finding.findingId} must cite transcript refs`);
    check(finding.patchDraft.patchMode === 'dry-run', `${fixtureFile} ${finding.findingId} patch draft must stay dry-run`);
    check(finding.patchDraft.mutatesFiles === false, `${fixtureFile} ${finding.findingId} patch draft must not mutate files`);
    check(finding.patchDraft.mutatesRegistry === false, `${fixtureFile} ${finding.findingId} patch draft must not mutate registry`);
    check(finding.patchDraft.requiresHumanReview === true, `${fixtureFile} ${finding.findingId} patch draft must require human review`);

    if (finding.findingKind === 'style-format-correction') {
      check(finding.signalScope === 'host-local', `${fixtureFile} style/format correction must stay host-local by default`);
      check(finding.atomId === undefined, `${fixtureFile} style/format correction must not leak atomId into a host-local preference`);
      check(finding.atomMapId === undefined, `${fixtureFile} style/format correction must not leak atomMapId into a host-local preference`);
      check(finding.recommendedTarget === 'host-local-overlay', `${fixtureFile} style/format correction must target host-local overlay`);
    }

    if (finding.findingKind === 'stale-or-wrong-skill') {
      check(Boolean(finding.skillId), `${fixtureFile} stale-or-wrong-skill finding must identify skillId`);
      check(finding.signalKind === 'loaded-but-wrong', `${fixtureFile} stale-or-wrong-skill finding must map to loaded-but-wrong signal`);
    }
  }

  validatedReports += 1;
  validatedFindings += report.findings.length;
}

let validatedTranscriptFixtures = 0;

for (const fixtureFile of transcriptFixtureFiles) {
  const relativePath = path.join('fixtures', 'evolution', 'conversation-skill-review', 'transcript-reviewer', fixtureFile).replace(/\\/g, '/');
  const fixture = readJson<TranscriptReviewFixture>(relativePath);
  check(validateTranscript(fixture.input.transcript) === true, `${fixtureFile} transcript failed schema validation: ${JSON.stringify(validateTranscript.errors)}`);
  const generatedReport = reviewConversationTranscript(fixture.input);
  check(validateReport(generatedReport) === true, `${fixtureFile} generated report failed schema validation: ${JSON.stringify(validateReport.errors)}`);
  check(validateReport(fixture.expectedReport) === true, `${fixtureFile} expected report failed schema validation: ${JSON.stringify(validateReport.errors)}`);
  assert.deepEqual(generatedReport, fixture.expectedReport, `${fixtureFile} generated report must match expectedReport`);

  for (const finding of generatedReport.findings) {
    seenKinds.add(finding.findingKind);
  }
  validatedTranscriptFixtures += 1;
  validatedReports += 1;
  validatedFindings += generatedReport.findings.length;
}

let validatedPatchDraftFixtures = 0;
let validatedPatchDrafts = 0;

for (const fixtureFile of patchDraftFixtureFiles) {
  const relativePath = path.join('fixtures', 'evolution', 'conversation-skill-review', 'patch-draft-bridge', fixtureFile).replace(/\\/g, '/');
  const fixture = readJson<PatchDraftBridgeFixture>(relativePath);
  const findingsReport = fixture.input.findingsReport ?? (fixture.input.findingsReportPath ? readJson<ConversationReviewFindingsReport>(fixture.input.findingsReportPath) : undefined);
  check(findingsReport !== undefined, `${fixtureFile} must provide findingsReport or findingsReportPath`);
  check(validateReport(findingsReport) === true, `${fixtureFile} input findings report failed schema validation: ${JSON.stringify(validateReport.errors)}`);

  const generatedReport = draftConversationPatches({
    findingsReport,
    generatedAt: fixture.input.generatedAt,
    bridgeName: fixture.input.bridgeName,
    sourceReportPath: fixture.input.sourceReportPath,
    proposedBy: fixture.input.proposedBy,
    atomVersionById: fixture.input.atomVersionById
  });
  check(validatePatchDraftReport(generatedReport) === true, `${fixtureFile} generated patch draft report failed schema validation: ${JSON.stringify(validatePatchDraftReport.errors)}`);
  check(validatePatchDraftReport(fixture.expectedReport) === true, `${fixtureFile} expected patch draft report failed schema validation: ${JSON.stringify(validatePatchDraftReport.errors)}`);
  assert.deepEqual(generatedReport, fixture.expectedReport, `${fixtureFile} generated patch draft report must match expectedReport`);
  assertPatchDraftReportInvariants(generatedReport, fixtureFile);

  validatedPatchDraftFixtures += 1;
  validatedPatchDrafts += generatedReport.drafts.length;
}

for (const findingKind of conversationReviewFindingKinds) {
  check(seenKinds.has(findingKind), `conversation skill review fixtures must cover ${findingKind}`);
}

ok(`validated ${validatedReports} conversation skill review report(s), ${validatedFindings} finding(s), ${seenKinds.size} finding kinds, transcriptFixtures=${validatedTranscriptFixtures}, patchDraftFixtures=${validatedPatchDraftFixtures}, patchDrafts=${validatedPatchDrafts}`);

function assertPatchDraftReportInvariants(report: ConversationPatchDraftReport, label: string): void {
  check(report.draftOnly.appliesAutomatically === false, `${label} patch drafts must not apply automatically`);
  check(report.draftOnly.mutatesFiles === false, `${label} patch draft report must not mutate files`);
  check(report.draftOnly.mutatesRegistry === false, `${label} patch draft report must not mutate registry`);
  check(report.draftOnly.mutatesSkillFiles === false, `${label} patch draft report must not mutate skill files`);
  check(report.draftOnly.requiresHumanReview === true, `${label} patch draft report must require human review`);
  check(report.summary.totalDrafts === report.drafts.length, `${label} summary.totalDrafts must match drafts length`);
  check(report.summary.totalFindings === report.sourceFindingsReport.findingIds.length, `${label} summary.totalFindings must match source finding ids`);
  check(report.summary.hostLocalDraftCount === report.drafts.filter((draft) => draft.draftKind === 'host-local-overlay').length, `${label} host-local draft count mismatch`);
  check(report.summary.skillDraftCount === report.drafts.filter((draft) => draft.draftKind === 'skill-patch').length, `${label} skill draft count mismatch`);
  check(report.summary.atomDraftCount === report.drafts.filter((draft) => draft.draftKind === 'atom-patch').length, `${label} atom draft count mismatch`);
  check(report.summary.atomMapDraftCount === report.drafts.filter((draft) => draft.draftKind === 'atom-map-patch').length, `${label} atom-map draft count mismatch`);
  check(report.summary.observationCount === report.drafts.filter((draft) => draft.draftKind === 'observation').length, `${label} observation count mismatch`);
  check(report.summary.humanReviewRequiredCount === report.drafts.filter((draft) => draft.requiresHumanReview).length, `${label} human review count mismatch`);

  for (const draft of report.drafts) {
    check(draft.patchMode === 'dry-run', `${label} ${draft.draftId} must stay dry-run`);
    check(draft.appliesAutomatically === false, `${label} ${draft.draftId} must not apply automatically`);
    check(draft.mutatesFiles === false, `${label} ${draft.draftId} must not mutate files`);
    check(draft.mutatesRegistry === false, `${label} ${draft.draftId} must not mutate registry`);
    check(draft.mutatesSkillFiles === false, `${label} ${draft.draftId} must not mutate skill files`);
    check(draft.requiresHumanReview === true, `${label} ${draft.draftId} must require human review`);
    check(draft.evidenceRefs.length > 0, `${label} ${draft.draftId} must cite evidence refs`);
    check(draft.sourceTranscriptRefs.length > 0, `${label} ${draft.draftId} must cite transcript refs`);

    if (draft.draftKind === 'host-local-overlay') {
      check(draft.atomId === undefined, `${label} ${draft.draftId} host-local draft must not carry atomId`);
      check(draft.atomMapId === undefined, `${label} ${draft.draftId} host-local draft must not carry atomMapId`);
      check(draft.upgradeProposalDraft === undefined, `${label} ${draft.draftId} host-local draft must not produce upgrade proposal`);
    }

    if (draft.draftKind === 'atom-patch') {
      check(draft.atomId !== undefined, `${label} ${draft.draftId} atom patch draft must cite atomId`);
      check(draft.upgradeProposalDraft !== undefined, `${label} ${draft.draftId} atom patch draft must include upgrade proposal draft`);
      check(validateUpgradeProposal(draft.upgradeProposalDraft) === true, `${label} ${draft.draftId} upgrade proposal draft failed schema validation: ${JSON.stringify(validateUpgradeProposal.errors)}`);
      check(draft.upgradeProposalDraft?.humanReview === 'pending', `${label} ${draft.draftId} upgrade proposal draft must await human review`);
      check(draft.upgradeProposalDraft?.targetSurface === 'atom-spec', `${label} ${draft.draftId} upgrade proposal draft must target atom-spec`);
      check(draft.upgradeProposalDraft?.inputs.some((entry) => entry.kind === 'evolution-evidence'), `${label} ${draft.draftId} upgrade proposal draft must cite evolution evidence input`);
      if (report.privacy.containsSensitiveInput) {
        check(draft.upgradeProposalDraft?.inputs.some((entry) => entry.kind === 'redaction-report'), `${label} ${draft.draftId} sensitive atom patch must cite redaction report input`);
      }
    }

    if (draft.findingKind === 'stale-or-wrong-skill') {
      check(Boolean(draft.skillId), `${label} ${draft.draftId} stale skill repair draft must cite skillId`);
      check(draft.draftKind === 'skill-patch', `${label} ${draft.draftId} stale skill repair must stay a skill patch draft`);
    }

    if (draft.draftKind === 'observation') {
      check(draft.upgradeProposalDraft === undefined, `${label} ${draft.draftId} observation draft must not include upgrade proposal`);
      check(draft.operation === 'observe-only', `${label} ${draft.draftId} observation draft must stay observe-only`);
    }
  }
}

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { conversationReviewFindingKinds, type ConversationReviewFindingsReport } from '../packages/plugin-sdk/src/conversation/conversation-review-finding.ts';
import { createValidator } from './lib/validator-harness.ts';
import type { AnySchema } from 'ajv';

const validator = createValidator('conversation-skill-review');
const { createAjv, readJson, repoPath, assert: check, ok } = validator;

const schema = readJson<AnySchema>('schemas/governance/conversation-review-findings-report.schema.json');
const ajv = createAjv();
const validateReport = ajv.compile(schema);
const fixtureRoot = repoPath('fixtures', 'evolution', 'conversation-skill-review');
const fixtureFiles = readdirSync(fixtureRoot)
  .filter((entry) => entry.endsWith('.json'))
  .sort();

check(fixtureFiles.length >= 1, 'expected conversation skill review fixtures');

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

for (const findingKind of conversationReviewFindingKinds) {
  check(seenKinds.has(findingKind), `conversation skill review fixtures must cover ${findingKind}`);
}

ok(`validated ${validatedReports} conversation skill review report(s), ${validatedFindings} finding(s), ${seenKinds.size} finding kinds`);

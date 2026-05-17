import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { AnySchema } from 'ajv';
import {
  createConversationFeedbackReport,
  createConversationSuppressionKey,
  type ConversationFeedbackChoiceState,
  type ConversationFeedbackPromptAction,
  type ConversationFeedbackReport,
  type ConversationFeedbackUserChoice
} from '../packages/plugin-sdk/src/conversation/conversation-feedback-loop.ts';
import type { ConversationReviewFindingsReport } from '../packages/plugin-sdk/src/conversation/conversation-review-finding.ts';
import { createValidator } from './lib/validator-harness.ts';

const validator = createValidator('conversation-feedback');
const { createAjv, readJson, repoPath, assert: check, ok } = validator;

const findingsSchema = readJson<AnySchema>('schemas/governance/conversation-review-findings-report.schema.json');
const feedbackSchema = readJson<AnySchema>('schemas/governance/conversation-feedback-report.schema.json');
const ajv = createAjv();
const validateFindingsReport = ajv.compile(findingsSchema);
const validateFeedbackReport = ajv.compile(feedbackSchema);

const fixtureRoot = repoPath('fixtures', 'evolution', 'conversation-feedback');
const fixtureFiles = existsSync(fixtureRoot)
  ? readdirSync(fixtureRoot).filter((entry) => entry.endsWith('.json')).sort()
  : [];

check(fixtureFiles.length >= 2, 'expected conversation feedback fixtures');

type FeedbackFixture = {
  readonly description?: string;
  readonly input: {
    readonly findingsReportPath: string;
    readonly generatedAt?: string;
    readonly sourceReportPath?: string;
    readonly choiceStateByFindingId?: Readonly<Record<string, {
      readonly choice: Exclude<ConversationFeedbackUserChoice, 'none'>;
      readonly chosenAt: string;
      readonly reason?: string;
    }>>;
    readonly occurrenceCountByFindingId?: Readonly<Record<string, number>>;
    readonly highSeverityFindingIds?: readonly string[];
    readonly highSeverityOverrideReason?: string;
  };
  readonly expected: {
    readonly summary: ConversationFeedbackReport['summary'];
    readonly events: Readonly<Record<string, {
      readonly promptAction: ConversationFeedbackPromptAction;
      readonly userChoice: ConversationFeedbackUserChoice;
      readonly shouldAskAgain: boolean;
      readonly occurrenceCount: number;
      readonly overrideReason?: string;
    }>>;
  };
};

const seenActions = new Set<ConversationFeedbackPromptAction>();
let validatedFixtures = 0;
let validatedEvents = 0;

for (const fixtureFile of fixtureFiles) {
  const relativePath = path.join('fixtures', 'evolution', 'conversation-feedback', fixtureFile).replace(/\\/g, '/');
  const fixture = readJson<FeedbackFixture>(relativePath);
  const findingsReport = readJson<ConversationReviewFindingsReport>(fixture.input.findingsReportPath);
  check(validateFindingsReport(findingsReport) === true, `${fixtureFile} findings report failed schema validation: ${JSON.stringify(validateFindingsReport.errors)}`);

  const choiceState = buildChoiceState(findingsReport, fixture.input.choiceStateByFindingId ?? {});
  const occurrenceCountBySuppressionKey = buildOccurrenceCounts(findingsReport, fixture.input.occurrenceCountByFindingId ?? {});
  const generatedReport = createConversationFeedbackReport({
    findingsReport,
    generatedAt: fixture.input.generatedAt,
    sourceReportPath: fixture.input.sourceReportPath,
    choiceState,
    occurrenceCountBySuppressionKey,
    highSeverityFindingIds: fixture.input.highSeverityFindingIds,
    highSeverityOverrideReason: fixture.input.highSeverityOverrideReason
  });

  check(validateFeedbackReport(generatedReport) === true, `${fixtureFile} generated feedback report failed schema validation: ${JSON.stringify(validateFeedbackReport.errors)}`);
  assert.deepEqual(generatedReport.summary, fixture.expected.summary, `${fixtureFile} feedback summary must match expected`);
  assertFeedbackInvariants(generatedReport, fixtureFile);

  for (const [findingId, expected] of Object.entries(fixture.expected.events)) {
    const event = generatedReport.events.find((candidate) => candidate.sourceFindingId === findingId);
    check(Boolean(event), `${fixtureFile} missing expected feedback event for ${findingId}`);
    check(event?.promptAction === expected.promptAction, `${fixtureFile} ${findingId} promptAction mismatch`);
    check(event?.userChoice === expected.userChoice, `${fixtureFile} ${findingId} userChoice mismatch`);
    check(event?.shouldAskAgain === expected.shouldAskAgain, `${fixtureFile} ${findingId} shouldAskAgain mismatch`);
    check(event?.occurrenceCount === expected.occurrenceCount, `${fixtureFile} ${findingId} occurrenceCount mismatch`);
    if (expected.overrideReason) {
      check(event?.overrideReason === expected.overrideReason, `${fixtureFile} ${findingId} overrideReason mismatch`);
    }
  }

  for (const event of generatedReport.events) {
    seenActions.add(event.promptAction);
  }
  validatedFixtures += 1;
  validatedEvents += generatedReport.events.length;
}

for (const action of ['ask-user', 'create-dry-run-draft', 'record-only-ask-later', 'record-only-suppressed', 'override-review-advisory'] as const) {
  check(seenActions.has(action), `conversation feedback fixtures must cover ${action}`);
}

ok(`validated ${validatedFixtures} conversation feedback fixture(s), events=${validatedEvents}, actions=${seenActions.size}`);

function buildChoiceState(
  findingsReport: ConversationReviewFindingsReport,
  byFindingId: FeedbackFixture['input']['choiceStateByFindingId']
): readonly ConversationFeedbackChoiceState[] {
  return Object.entries(byFindingId ?? {}).map(([findingId, choice]) => {
    const finding = findingsReport.findings.find((candidate) => candidate.findingId === findingId);
    check(Boolean(finding), `choice state references missing finding: ${findingId}`);
    return {
      suppressionKey: createConversationSuppressionKey(finding!),
      choice: choice.choice,
      chosenAt: choice.chosenAt,
      findingId,
      ...(choice.reason ? { reason: choice.reason } : {})
    };
  });
}

function buildOccurrenceCounts(
  findingsReport: ConversationReviewFindingsReport,
  byFindingId: FeedbackFixture['input']['occurrenceCountByFindingId']
): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(byFindingId ?? {}).map(([findingId, count]) => {
    const finding = findingsReport.findings.find((candidate) => candidate.findingId === findingId);
    check(Boolean(finding), `occurrence count references missing finding: ${findingId}`);
    return [createConversationSuppressionKey(finding!), count];
  }));
}

function assertFeedbackInvariants(report: ConversationFeedbackReport, label: string): void {
  check(report.draftOnly.appliesAutomatically === false, `${label} feedback report must not apply automatically`);
  check(report.draftOnly.mutatesFiles === false, `${label} feedback report must not mutate files`);
  check(report.draftOnly.mutatesRegistry === false, `${label} feedback report must not mutate registry`);
  check(report.draftOnly.mutatesSkillFiles === false, `${label} feedback report must not mutate skill files`);
  check(report.draftOnly.requiresHumanReview === true, `${label} feedback report must require human review`);
  check(report.summary.totalEvents === report.events.length, `${label} totalEvents must match event length`);
  check(report.summary.totalFindings === report.sourceFindingsReport.findingIds.length, `${label} totalFindings must match source finding ids`);
  check(report.summary.recordedEvidenceCount === report.events.reduce((sum, event) => sum + event.evidenceRefs.length, 0), `${label} recordedEvidenceCount mismatch`);
  check(report.summary.promptCount === report.events.filter((event) => event.promptAction === 'ask-user').length, `${label} promptCount mismatch`);
  check(report.summary.draftNowCount === report.events.filter((event) => event.promptAction === 'create-dry-run-draft').length, `${label} draftNowCount mismatch`);
  check(report.summary.deferredCount === report.events.filter((event) => event.promptAction === 'record-only-ask-later').length, `${label} deferredCount mismatch`);
  check(report.summary.suppressedCount === report.events.filter((event) => event.promptAction === 'record-only-suppressed').length, `${label} suppressedCount mismatch`);
  check(report.summary.overrideCount === report.events.filter((event) => event.promptAction === 'override-review-advisory').length, `${label} overrideCount mismatch`);

  for (const event of report.events) {
    check(event.feedbackMessage.startsWith('Recorded finding '), `${label} ${event.eventId} must visibly acknowledge recording`);
    check(event.suppressionKey.includes('surface='), `${label} ${event.eventId} suppressionKey must include target surface`);
    check(event.suppressionKey.includes('|target='), `${label} ${event.eventId} suppressionKey must include target id slot`);
    check(event.suppressionKey.includes('|kind='), `${label} ${event.eventId} suppressionKey must include finding kind`);
    check(event.suppressionKey.includes('|tags='), `${label} ${event.eventId} suppressionKey must include pattern tags`);
    check(event.evidenceRefs.length > 0, `${label} ${event.eventId} must keep evidence refs`);
    check(event.sourceTranscriptRefs.length > 0, `${label} ${event.eventId} must keep transcript refs`);
    check(event.nextSteps.includes('record-feedback-event') || event.promptAction === 'create-dry-run-draft', `${label} ${event.eventId} must preserve a concrete next step`);

    if (event.userChoice === 'N') {
      check(event.promptAction === 'record-only-ask-later', `${label} ${event.eventId} N must defer but ask later`);
      check(event.shouldAskAgain === true, `${label} ${event.eventId} N must keep asking on recurrence`);
    }
    if (event.userChoice === 'X' && event.promptAction !== 'override-review-advisory') {
      check(event.promptAction === 'record-only-suppressed', `${label} ${event.eventId} X must suppress future prompts`);
      check(event.shouldAskAgain === false, `${label} ${event.eventId} X must not ask again`);
    }
    if (event.promptAction === 'override-review-advisory') {
      check(Boolean(event.overrideReason), `${label} ${event.eventId} override must explain why suppression was bypassed`);
      check(event.nextSteps.includes('request-review-advisory'), `${label} ${event.eventId} override must route through ReviewAdvisory`);
    }
  }
}
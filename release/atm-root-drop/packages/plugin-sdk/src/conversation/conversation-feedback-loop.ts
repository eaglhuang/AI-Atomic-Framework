import type {
  ConversationReviewFinding,
  ConversationReviewFindingKind,
  ConversationReviewFindingsReport
} from './conversation-review-finding';

export const conversationFeedbackRendererName = 'deterministic-conversation-feedback-loop';

export type ConversationFeedbackUserChoice = 'Y' | 'N' | 'X' | 'none';

export type ConversationFeedbackPromptAction =
  | 'ask-user'
  | 'create-dry-run-draft'
  | 'record-only-ask-later'
  | 'record-only-suppressed'
  | 'override-review-advisory';

export type ConversationFeedbackTargetSurface =
  | 'host-local-overlay'
  | 'skill'
  | 'atom-spec'
  | 'atom-map'
  | 'observation';

export interface ConversationFeedbackChoiceState {
  readonly suppressionKey: string;
  readonly choice: Exclude<ConversationFeedbackUserChoice, 'none'>;
  readonly chosenAt: string;
  readonly findingId?: string;
  readonly reason?: string;
}

export interface ConversationFeedbackLoopInput {
  readonly findingsReport: ConversationReviewFindingsReport;
  readonly generatedAt?: string;
  readonly rendererName?: string;
  readonly sourceReportPath?: string;
  readonly choiceState?: readonly ConversationFeedbackChoiceState[];
  readonly occurrenceCountBySuppressionKey?: Readonly<Record<string, number>>;
  readonly highSeverityFindingIds?: readonly string[];
  readonly highSeverityOverrideReason?: string;
}

export interface ConversationFeedbackReport {
  readonly schemaId: 'atm.conversationFeedbackReport';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly generatedAt: string;
  readonly rendererName: string;
  readonly sourceFindingsReport: {
    readonly schemaId: 'atm.conversationReviewFindingsReport';
    readonly artifactPath?: string;
    readonly transcriptId: string;
    readonly sessionId?: string;
    readonly findingIds: readonly string[];
  };
  readonly privacy: {
    readonly redacted: true;
    readonly containsSensitiveInput: boolean;
    readonly redactionReportPaths: readonly string[];
  };
  readonly summary: ConversationFeedbackSummary;
  readonly events: readonly ConversationFeedbackEvent[];
  readonly draftOnly: {
    readonly appliesAutomatically: false;
    readonly mutatesFiles: false;
    readonly mutatesRegistry: false;
    readonly mutatesSkillFiles: false;
    readonly requiresHumanReview: true;
  };
}

export interface ConversationFeedbackSummary {
  readonly totalFindings: number;
  readonly totalEvents: number;
  readonly recordedEvidenceCount: number;
  readonly promptCount: number;
  readonly draftNowCount: number;
  readonly deferredCount: number;
  readonly suppressedCount: number;
  readonly overrideCount: number;
}

export interface ConversationFeedbackEvent {
  readonly eventId: string;
  readonly sourceFindingId: string;
  readonly findingKind: ConversationReviewFindingKind;
  readonly targetSurface: ConversationFeedbackTargetSurface;
  readonly targetId?: string;
  readonly patternTags: readonly string[];
  readonly suppressionKey: string;
  readonly occurrenceCount: number;
  readonly userChoice: ConversationFeedbackUserChoice;
  readonly promptAction: ConversationFeedbackPromptAction;
  readonly shouldAskAgain: boolean;
  readonly overrideReason?: string;
  readonly feedbackMessage: string;
  readonly sourceTranscriptRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly nextSteps: readonly string[];
}

export function createConversationFeedbackReport(input: ConversationFeedbackLoopInput): ConversationFeedbackReport {
  const findingsReport = input.findingsReport;
  const events = findingsReport.findings.map((finding) => createFeedbackEvent({
    finding,
    choiceState: input.choiceState ?? [],
    occurrenceCountBySuppressionKey: input.occurrenceCountBySuppressionKey ?? {},
    highSeverityFindingIds: input.highSeverityFindingIds ?? [],
    highSeverityOverrideReason: input.highSeverityOverrideReason
      ?? 'High-severity recurrence can override prompt suppression, but still requires ReviewAdvisory and HumanReviewDecision.'
  }));

  return {
    schemaId: 'atm.conversationFeedbackReport',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Deterministic immediate feedback report for conversation-derived criticism findings.'
    },
    generatedAt: input.generatedAt ?? findingsReport.generatedAt,
    rendererName: input.rendererName ?? conversationFeedbackRendererName,
    sourceFindingsReport: {
      schemaId: 'atm.conversationReviewFindingsReport',
      ...(input.sourceReportPath ? { artifactPath: input.sourceReportPath } : {}),
      transcriptId: findingsReport.sourceTranscript.transcriptId,
      ...(findingsReport.sourceTranscript.sessionId ? { sessionId: findingsReport.sourceTranscript.sessionId } : {}),
      findingIds: findingsReport.findings.map((finding) => finding.findingId).sort()
    },
    privacy: {
      redacted: true,
      containsSensitiveInput: findingsReport.privacy.containsSensitiveInput,
      redactionReportPaths: findingsReport.privacy.redactionReportPaths
    },
    summary: summarizeFeedback(findingsReport.findings.length, events),
    events,
    draftOnly: {
      appliesAutomatically: false,
      mutatesFiles: false,
      mutatesRegistry: false,
      mutatesSkillFiles: false,
      requiresHumanReview: true
    }
  };
}

export function createConversationSuppressionKey(finding: ConversationReviewFinding): string {
  const targetSurface = mapTargetSurface(finding);
  const targetId = resolveTargetId(finding);
  const patternTags = createPatternTags(finding);
  return [
    `surface=${targetSurface}`,
    `target=${targetId ?? 'none'}`,
    `kind=${finding.findingKind}`,
    `tags=${patternTags.join('+')}`
  ].join('|');
}

export function upsertConversationFeedbackChoiceState(
  existing: readonly ConversationFeedbackChoiceState[],
  nextChoice: ConversationFeedbackChoiceState
): readonly ConversationFeedbackChoiceState[] {
  return [
    ...existing.filter((entry) => entry.suppressionKey !== nextChoice.suppressionKey),
    nextChoice
  ];
}

function createFeedbackEvent(context: {
  readonly finding: ConversationReviewFinding;
  readonly choiceState: readonly ConversationFeedbackChoiceState[];
  readonly occurrenceCountBySuppressionKey: Readonly<Record<string, number>>;
  readonly highSeverityFindingIds: readonly string[];
  readonly highSeverityOverrideReason: string;
}): ConversationFeedbackEvent {
  const finding = context.finding;
  const targetSurface = mapTargetSurface(finding);
  const targetId = resolveTargetId(finding);
  const patternTags = createPatternTags(finding);
  const suppressionKey = createConversationSuppressionKey(finding);
  const userChoice = findLatestChoice(context.choiceState, suppressionKey)?.choice ?? 'none';
  const highSeverity = context.highSeverityFindingIds.includes(finding.findingId);
  const promptAction = decidePromptAction(userChoice, highSeverity);
  const shouldAskAgain = promptAction === 'ask-user'
    || promptAction === 'record-only-ask-later'
    || promptAction === 'override-review-advisory';
  const occurrenceCount = Math.max(1, context.occurrenceCountBySuppressionKey[suppressionKey] ?? 1);
  const overrideReason = promptAction === 'override-review-advisory'
    ? context.highSeverityOverrideReason
    : undefined;

  return {
    eventId: `feedback.${sanitizeIdentifier(finding.findingId)}`,
    sourceFindingId: finding.findingId,
    findingKind: finding.findingKind,
    targetSurface,
    ...(targetId ? { targetId } : {}),
    patternTags,
    suppressionKey,
    occurrenceCount,
    userChoice,
    promptAction,
    shouldAskAgain,
    ...(overrideReason ? { overrideReason } : {}),
    feedbackMessage: createFeedbackMessage(finding, promptAction, targetSurface, suppressionKey),
    sourceTranscriptRefs: [...finding.sourceTranscriptRefs],
    evidenceRefs: [...finding.evidenceRefs],
    nextSteps: createNextSteps(promptAction)
  };
}

function decidePromptAction(userChoice: ConversationFeedbackUserChoice, highSeverity: boolean): ConversationFeedbackPromptAction {
  if (highSeverity && (userChoice === 'N' || userChoice === 'X')) {
    return 'override-review-advisory';
  }
  if (userChoice === 'Y') return 'create-dry-run-draft';
  if (userChoice === 'N') return 'record-only-ask-later';
  if (userChoice === 'X') return 'record-only-suppressed';
  return 'ask-user';
}

function findLatestChoice(
  choiceState: readonly ConversationFeedbackChoiceState[],
  suppressionKey: string
): ConversationFeedbackChoiceState | undefined {
  return [...choiceState]
    .filter((entry) => entry.suppressionKey === suppressionKey)
    .sort((left, right) => left.chosenAt.localeCompare(right.chosenAt))
    .at(-1);
}

function mapTargetSurface(finding: ConversationReviewFinding): ConversationFeedbackTargetSurface {
  switch (finding.recommendedTarget) {
    case 'host-local-overlay':
      return 'host-local-overlay';
    case 'skill-patch-draft':
      return 'skill';
    case 'atom-patch-draft':
      return 'atom-spec';
    case 'atom-map-patch-draft':
      return 'atom-map';
    case 'observation-only':
      return 'observation';
  }
}

function resolveTargetId(finding: ConversationReviewFinding): string | undefined {
  return finding.atomId ?? finding.atomMapId ?? finding.skillId;
}

function createPatternTags(finding: ConversationReviewFinding): readonly string[] {
  return [finding.signalKind, finding.signalScope, finding.findingKind].sort();
}

function createFeedbackMessage(
  finding: ConversationReviewFinding,
  promptAction: ConversationFeedbackPromptAction,
  targetSurface: ConversationFeedbackTargetSurface,
  suppressionKey: string
): string {
  const prefix = `Recorded finding ${finding.findingId} for ${targetSurface}; suppressionKey=${suppressionKey}.`;
  switch (promptAction) {
    case 'ask-user':
      return `${prefix} Ask user: Y=create a dry-run improvement draft, N=defer and keep recurrence, X=never ask for this pattern.`;
    case 'create-dry-run-draft':
      return `${prefix} User chose Y; route to dry-run draft creation with ReviewAdvisory and HumanReviewDecision.`;
    case 'record-only-ask-later':
      return `${prefix} User chose N; keep evidence and recurrence, then ask again when the pattern recurs.`;
    case 'record-only-suppressed':
      return `${prefix} User chose X; keep evidence but do not ask again for this pattern.`;
    case 'override-review-advisory':
      return `${prefix} High-severity recurrence overrides prompt suppression and must be surfaced through ReviewAdvisory.`;
  }
}

function createNextSteps(promptAction: ConversationFeedbackPromptAction): readonly string[] {
  switch (promptAction) {
    case 'ask-user':
      return ['show-choice-prompt:Y/N/X', 'record-feedback-event', 'do-not-mutate'];
    case 'create-dry-run-draft':
      return ['create-dry-run-draft', 'request-review-advisory', 'request-human-review'];
    case 'record-only-ask-later':
      return ['record-feedback-event', 'keep-recurrence-counter', 'ask-again-on-recurrence'];
    case 'record-only-suppressed':
      return ['record-feedback-event', 'keep-recurrence-counter', 'suppress-future-prompts'];
    case 'override-review-advisory':
      return ['record-feedback-event', 'show-override-reason', 'request-review-advisory'];
  }
}

function summarizeFeedback(totalFindings: number, events: readonly ConversationFeedbackEvent[]): ConversationFeedbackSummary {
  return {
    totalFindings,
    totalEvents: events.length,
    recordedEvidenceCount: events.reduce((sum, event) => sum + event.evidenceRefs.length, 0),
    promptCount: events.filter((event) => event.promptAction === 'ask-user').length,
    draftNowCount: events.filter((event) => event.promptAction === 'create-dry-run-draft').length,
    deferredCount: events.filter((event) => event.promptAction === 'record-only-ask-later').length,
    suppressedCount: events.filter((event) => event.promptAction === 'record-only-suppressed').length,
    overrideCount: events.filter((event) => event.promptAction === 'override-review-advisory').length
  };
}

function sanitizeIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'unspecified';
}
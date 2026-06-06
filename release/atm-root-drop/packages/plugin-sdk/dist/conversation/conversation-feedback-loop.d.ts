import type { ConversationReviewFinding, ConversationReviewFindingKind, ConversationReviewFindingsReport } from './conversation-review-finding';
export declare const conversationFeedbackRendererName = "deterministic-conversation-feedback-loop";
export type ConversationFeedbackUserChoice = 'Y' | 'N' | 'X' | 'none';
export type ConversationFeedbackPromptAction = 'ask-user' | 'create-dry-run-draft' | 'record-only-ask-later' | 'record-only-suppressed' | 'override-review-advisory';
export type ConversationFeedbackTargetSurface = 'host-local-overlay' | 'skill' | 'atom-spec' | 'atom-map' | 'observation';
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
export declare function createConversationFeedbackReport(input: ConversationFeedbackLoopInput): ConversationFeedbackReport;
export declare function createConversationSuppressionKey(finding: ConversationReviewFinding): string;
export declare function upsertConversationFeedbackChoiceState(existing: readonly ConversationFeedbackChoiceState[], nextChoice: ConversationFeedbackChoiceState): readonly ConversationFeedbackChoiceState[];

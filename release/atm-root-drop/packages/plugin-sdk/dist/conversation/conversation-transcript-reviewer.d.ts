import type { ConversationReviewFindingsReport } from './conversation-review-finding';
export interface ConversationTranscriptTurn {
    readonly turnId: string;
    readonly role: 'user' | 'agent' | 'system';
    readonly content: string;
    readonly atomId?: string;
    readonly atomMapId?: string;
    readonly skillId?: string;
    readonly evidenceRefs?: readonly string[];
    readonly confidence?: number;
    readonly occurredAt?: string;
}
export interface ConversationTranscript {
    readonly schemaId: 'atm.conversationTranscript';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly transcriptId: string;
    readonly sessionId?: string;
    readonly window?: string;
    readonly redacted: true;
    readonly containsSensitiveInput: boolean;
    readonly artifactPaths: readonly string[];
    readonly redactionReportPaths?: readonly string[];
    readonly turns: readonly ConversationTranscriptTurn[];
}
export interface ConversationTranscriptReviewInput {
    readonly transcript: ConversationTranscript;
    readonly generatedAt?: string;
    readonly reviewerName?: string;
    readonly window?: string;
}
export type ConversationTranscriptReviewErrorCode = 'unredacted-transcript' | 'sensitive-without-redaction-report';
export declare class ConversationTranscriptReviewError extends Error {
    readonly code: ConversationTranscriptReviewErrorCode;
    readonly transcriptId: string;
    constructor(code: ConversationTranscriptReviewErrorCode, transcriptId: string, message: string);
}
export declare const conversationTranscriptReviewerName = "deterministic-conversation-transcript-reviewer";
export declare function reviewConversationTranscript(input: ConversationTranscriptReviewInput): ConversationReviewFindingsReport;

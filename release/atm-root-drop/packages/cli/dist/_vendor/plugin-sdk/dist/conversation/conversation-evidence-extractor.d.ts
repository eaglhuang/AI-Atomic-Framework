import type { EvidenceRecord, EvidenceSignalScope } from '@ai-atomic-framework/core';
export type ConversationTurnIntent = 'correction' | 'failure' | 'wrong-load' | 'preference' | 'success' | 'rollback-success' | 'novel-technique' | 'neutral';
export interface ConversationTurn {
    readonly role: 'user' | 'agent' | 'system';
    readonly intent: ConversationTurnIntent;
    readonly summary: string;
    readonly tags?: readonly string[];
    readonly confidence?: number;
    readonly occurredAt?: string;
}
export interface ConversationLog {
    readonly sessionId: string;
    readonly window?: string;
    readonly redacted: true;
    readonly containsSensitiveInput?: boolean;
    readonly redactionReport?: string;
    readonly atomId?: string;
    readonly atomMapId?: string;
    readonly signalScope?: EvidenceSignalScope;
    readonly turns: readonly ConversationTurn[];
    readonly producedBy?: string;
}
export interface ConversationEvidenceExtractionInput {
    readonly logs: readonly ConversationLog[];
    readonly window?: string;
    readonly extractorName?: string;
}
export interface ConversationEvidenceExtractionReport {
    readonly schemaId: 'atm.conversationEvidenceExtractionReport';
    readonly specVersion: '0.1.0';
    readonly extractorName: string;
    readonly window?: string;
    readonly summary: {
        readonly totalLogs: number;
        readonly totalTurns: number;
        readonly emittedEvidence: number;
        readonly skippedSessions: number;
    };
    readonly evidence: readonly EvidenceRecord[];
    readonly skippedSessions: readonly {
        readonly sessionId: string;
        readonly reason: string;
    }[];
}
export type ConversationDrivenExtractionErrorCode = 'unredacted-input' | 'sensitive-without-redaction-report';
export declare class ConversationDrivenExtractionError extends Error {
    readonly code: ConversationDrivenExtractionErrorCode;
    readonly sessionId: string;
    constructor(code: ConversationDrivenExtractionErrorCode, sessionId: string, message: string);
}
export declare const conversationEvidenceExtractorName = "deterministic-conversation-evidence-extractor";
export declare function extractEvidenceFromConversations(input: ConversationEvidenceExtractionInput): ConversationEvidenceExtractionReport;

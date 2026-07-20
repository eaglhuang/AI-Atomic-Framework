import type { EvidenceRecord } from '@ai-atomic-framework/core';
import { type HumanReviewDecision, type HumanReviewQueueRecord } from './queue.ts';
export interface HumanReviewDecisionLogInput {
    readonly queueRecord: HumanReviewQueueRecord;
    readonly decision: HumanReviewDecision;
    readonly reason: string;
    readonly decidedBy: string;
    readonly decidedAt: string;
    readonly queuePath: string;
    readonly projectionPath: string;
    readonly evidenceId?: string;
}
export interface HumanReviewDecisionEvidence extends EvidenceRecord {
    readonly schemaId: 'atm.evidence.humanReviewDecision';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
}
export interface HumanReviewDecisionLog {
    readonly schemaId: 'atm.humanReviewDecision';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly decisionId: string;
    readonly proposalId: string;
    readonly atomId: string;
    readonly decision: HumanReviewDecision;
    readonly reason: string;
    readonly decidedBy: string;
    readonly decidedAt: string;
    readonly decisionSnapshotHash: string;
    readonly queuePath: string;
    readonly projectionPath: string;
    readonly queueRecord: HumanReviewQueueRecord;
    readonly evidence: HumanReviewDecisionEvidence;
}
export interface HumanReviewDecisionValidationResult {
    readonly ok: boolean;
    readonly issues: readonly string[];
}
export declare const humanReviewDecisionPackage: {
    readonly packageName: "@ai-atomic-framework/plugin-human-review";
    readonly packageRole: "human-review-decision-helpers";
    readonly packageVersion: "0.0.0";
};
export declare function createHumanReviewDecisionLog(input: HumanReviewDecisionLogInput): HumanReviewDecisionLog;
export declare function validateHumanReviewDecisionLog(log: HumanReviewDecisionLog): HumanReviewDecisionValidationResult;

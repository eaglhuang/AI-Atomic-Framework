export declare const PHASE_SUITE_PROMOTION_REPORT_SCHEMA_ID: "atm.phaseSuitePromotionReport.v1";
export type PhaseSuiteCheckpoint = 'batch' | 'milestone' | 'plan-verdict' | 'candidate' | 'pre-close' | 'release' | string;
export type PhaseSuiteBlockReason = 'missing' | 'stale' | 'failed';
export interface PhaseSuiteReceipt {
    readonly caseId: string;
    readonly status?: string | null;
    readonly gitHead?: string | null;
    readonly observedAt?: string | null;
    readonly freshUntil?: string | null;
    readonly durationMs?: number | null;
    readonly cacheDecision?: string | null;
    readonly fanOutConsumerCount?: number | null;
    readonly queueWaitMs?: number | null;
    readonly defectTier?: string | null;
}
export interface PhaseSuitePromotionInput {
    readonly checkpoint: PhaseSuiteCheckpoint;
    readonly requiredPhaseCaseIds: readonly string[];
    readonly receipts: readonly PhaseSuiteReceipt[];
    readonly gitHead?: string | null;
    readonly now?: string | null;
    readonly freshnessWindowMs?: number | null;
    readonly catalogPhaseCaseCount?: number | null;
}
export interface PhaseSuiteBlocker {
    readonly caseId: string;
    readonly reason: PhaseSuiteBlockReason;
    readonly detail: string;
    readonly receiptGitHead: string | null;
}
export interface PhaseSuiteMetrics {
    readonly schemaId: 'atm.phaseSuiteMetrics.v1';
    readonly cacheHitCount: number;
    readonly cacheMissCount: number;
    readonly fanOutConsumerCount: number;
    readonly queueWaitMs: number;
    readonly selectionRatio: number;
    readonly durationMs: number;
    readonly falseBlockCount: number;
    readonly defectDetectionTier: 'clean' | 'stale-guard' | 'blocking';
}
export interface PhaseSuitePromotionReport {
    readonly schemaId: typeof PHASE_SUITE_PROMOTION_REPORT_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly checkpoint: PhaseSuiteCheckpoint;
    readonly ok: boolean;
    readonly blocked: boolean;
    readonly promotionAllowed: boolean;
    readonly requiredCaseIds: readonly string[];
    readonly satisfiedCaseIds: readonly string[];
    readonly blockers: readonly PhaseSuiteBlocker[];
    readonly metrics: PhaseSuiteMetrics;
}
export declare function evaluatePhaseSuitePromotion(input: PhaseSuitePromotionInput): PhaseSuitePromotionReport;

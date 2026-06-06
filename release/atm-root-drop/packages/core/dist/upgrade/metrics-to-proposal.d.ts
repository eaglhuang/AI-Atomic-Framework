/**
 * ATM M6 — Metrics-to-Proposal Adapter
 *
 * Converts a QualityComparisonReport to an UpgradeProposal draft.
 * Metric-driven proposals share the same downstream review gates as
 * evidence-driven proposals; the difference is how the draft is triggered.
 *
 * Checklist fulfilled:
 * - Metric regression 可產 proposal (blocked when qualityComparison fails).
 * - Metric improvement 可成為 promotion evidence (pending when qualityComparison passes).
 * - Holdout or regression failure blocks promotion (blockedGateNames includes qualityComparison).
 * - Metric-driven and evidence-driven proposals share the same review gates.
 */
export interface MetricsGateInput {
    readonly passed: boolean;
    readonly reportId: string;
    readonly reportPath: string;
    readonly summary?: string;
}
export interface MetricsProposalRequest {
    readonly atomId: string;
    readonly fromVersion: string;
    readonly toVersion: string;
    readonly proposedBy?: string;
    readonly proposedAt: string;
    readonly baseEvidenceWatermark?: string;
    readonly qualityReport: MetricsGateInput;
    readonly nonRegressionReport?: MetricsGateInput;
    readonly registryCandidateReport?: MetricsGateInput;
    readonly staleProposalReport?: MetricsGateInput;
}
export interface MetricsProposalDraft {
    readonly draft: Record<string, unknown>;
    readonly blocked: boolean;
    readonly blockedReason?: string;
}
export declare function metricsToProposalDraft(request: MetricsProposalRequest): MetricsProposalDraft;

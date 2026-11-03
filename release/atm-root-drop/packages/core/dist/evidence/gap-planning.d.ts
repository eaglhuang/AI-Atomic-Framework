export declare const GAP_NORMALIZATION_SCHEMA_ID: "atm.gapNormalization.v1";
export declare const LEXICOGRAPHIC_PROPOSAL_PLAN_SCHEMA_ID: "atm.lexicographicProposalPlan.v1";
export type GapPlanningStatus = 'proven' | 'blocked' | 'contradictory';
export interface GapObservationInput {
    readonly kind: string;
    readonly target: string;
    readonly dimension: string;
    readonly expected: string;
    readonly observed: string;
    readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface NormalizedGap {
    readonly gapId: string;
    readonly kind: string;
    readonly target: string;
    readonly dimension: string;
    readonly expected: string;
    readonly observed: string;
    readonly provenance: Readonly<Record<string, unknown>>;
}
export interface GapNormalizationResult {
    readonly schemaId: typeof GAP_NORMALIZATION_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly status: GapPlanningStatus;
    readonly gaps: readonly NormalizedGap[];
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly frontierDigest: string;
}
export interface ProposalInput {
    readonly proposalId: string;
    readonly gapId: string;
    readonly action: string;
    readonly target: string;
    readonly preconditionDigest: string;
    readonly postconditionDigest: string;
    readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface OrderedProposal extends ProposalInput {
    readonly proposalDigest: string;
}
export interface LexicographicProposalPlan {
    readonly schemaId: typeof LEXICOGRAPHIC_PROPOSAL_PLAN_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly status: GapPlanningStatus;
    readonly baseFrontier: readonly string[];
    readonly orderedProposals: readonly OrderedProposal[];
    readonly acceptedProposalIds: readonly string[];
    readonly resultingFrontier: readonly string[];
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly planDigest: string;
}
export declare function normalizeGaps(observations: readonly GapObservationInput[]): GapNormalizationResult;
export declare const compileGapNormalization: typeof normalizeGaps;
export declare function planLexicographicProposals(input: {
    readonly frontier: GapNormalizationResult | readonly string[];
    readonly proposals: readonly ProposalInput[];
    readonly acceptedProposalIds?: readonly string[];
}): LexicographicProposalPlan;
export declare const compileLexicographicProposalPlan: typeof planLexicographicProposals;
export declare function replayLexicographicProposalPlan(plan: LexicographicProposalPlan): LexicographicProposalPlan;
export declare function validateLexicographicProposalPlan(plan: LexicographicProposalPlan): {
    ok: boolean;
    diagnostics: string[];
};

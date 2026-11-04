/**
 * M4 Promotion Safety Gates
 *
 * Deterministic gates that evaluate whether a proposal is safe to promote.
 * These gates operate independently of the semantic advisory provider and
 * always apply before any promotion action.
 *
 * Gates:
 *  1. baseAtomVersionMismatch    – current atom version must match baseAtomVersion
 *  2. staleEvidenceWatermark     – evidence watermark must not be stale
 *  3. targetSurfaceDowngrade     – single-user evidence cannot target atom-spec
 *  4. breakingHumanReview        – breaking proposals must be reviewed by a human
 *  5. missingRedactionReport     – proposals that considered sensitive inputs must attach a redaction report
 */
export type PromotionSafetyGateName = 'baseAtomVersionMismatch' | 'staleEvidenceWatermark' | 'targetSurfaceDowngrade' | 'breakingHumanReview' | 'missingRedactionReport' | 'charterInvariantViolation';
export interface PromotionSafetyFinding {
    /** Gate that produced this finding. */
    gate: PromotionSafetyGateName;
    /** Whether this gate is blocking promotion. */
    blocked: boolean;
    /** Human-readable explanation. */
    reason: string;
    /** Suggested action to unblock. */
    remediation?: string;
}
export interface PromotionSafetyGateResult {
    /** True when all gates passed. */
    passed: boolean;
    /** Names of gates that blocked promotion. */
    blockedGates: PromotionSafetyGateName[];
    /** Per-gate detail. */
    findings: PromotionSafetyFinding[];
}
/**
 * Runtime context provided by the host or promotion layer.
 * All fields are optional; absent fields are treated as "not applicable" for that gate.
 */
export interface PromotionSafetyContext {
    /**
     * The current live version of the atom being targeted.
     * When provided, gate 1 compares it against proposal.baseAtomVersion.
     */
    currentAtomVersion?: string;
    /**
     * The current live version of the atom map being targeted.
     * When provided, gate 1 variant compares it against proposal.baseMapVersion.
     */
    currentMapVersion?: string;
    /**
     * True when a newer human decision has superseded the position recorded in
     * proposal.baseEvidenceWatermark.
     */
    isEvidenceWatermarkStale?: boolean;
    /**
     * True when all matched evidence was scoped to a single user or a single
     * host-local session (and therefore should not auto-promote to atom-spec).
     */
    evidenceScopeIsUserLocal?: boolean;
    /**
     * Explicitly set to false when the host knows the proposal considered
     * sensitive inputs but has not produced a redaction report.
     * When undefined, the gate falls back to checking proposal.inputs for a
     * 'redaction-report' entry.
     */
    hasRedactionReport?: boolean;
    /**
     * List of charter invariant rule IDs that this proposal violates.
     * When non-empty and no charterWaiver is attached to the proposal, gate 6 blocks.
     */
    charterViolations?: string[];
}
/**
 * Minimal proposal shape accepted by checkPromotionSafetyGates.
 * Compatible with the full atm.upgradeProposal JSON structure.
 */
export interface ProposalForSafetyCheck {
    baseAtomVersion?: string;
    baseMapVersion?: string;
    baseEvidenceWatermark?: string;
    targetSurface?: string;
    reversibility?: string;
    inputs?: Array<{
        kind: string;
    }>;
    charterWaiver?: {
        reason: string;
        approvedBy: string;
        approvedAt: string;
    };
}
/**
 * Evaluate all M4 promotion safety gates against a proposal and context.
 *
 * @param proposal  A parsed upgrade proposal (or subset thereof).
 * @param context   Runtime context supplied by the host or promotion layer.
 * @returns         A PromotionSafetyGateResult with per-gate details.
 */
export declare function checkPromotionSafetyGates(proposal: ProposalForSafetyCheck, context: PromotionSafetyContext): PromotionSafetyGateResult;

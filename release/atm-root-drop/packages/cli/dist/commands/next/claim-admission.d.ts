/**
 * TASK-RFT-0011 — next.claim.admission atom.
 *
 * The pre-fix bug: `broker register` returns `parallel-safe` /
 * `lane: direct-brokered` via `packages/core/src/broker/conflict-matrix.ts`,
 * but `next --claim` runs a separate parallel-preflight and throws
 * `ATM_NEXT_CLAIM_BLOCKED` on the same atom overlap. The two gates should
 * agree — one broker verdict, one CID gate — so an operator seeing "broker OK"
 * never gets a claim block a moment later.
 *
 * This module owns the policy decision "should next --claim admit this
 * candidate?" It takes two verdicts as inputs:
 *
 *   - the *broker verdict* — the arbitration verdict from
 *     `evaluateConflictMatrix(newIntent, activeIntents)` in the exact same
 *     module the `broker register` command uses. Passed in by the caller
 *     (next.ts) so this module stays pure and testable.
 *   - the *CID gate verdict* — the legacy diagnostic the `next --claim`
 *     preflight computes from `parallel` findings. This module treats it as a
 *     diagnostic wrapper: it does not gate on it, but it does surface a
 *     divergence diagnostic when the two disagree.
 *
 * The final admission decision is driven by the broker verdict. This means:
 *   - broker `allow` / `watch` → admitted
 *   - broker `freeze` → blocked (mirrors what `broker register` already tells
 *     the operator)
 *   - broker `takeover` → admitted with an advisory
 */
import type { BrokerArbitrationVerdict } from '../../../../core/src/broker/conflict-matrix.ts';
export type ClaimAdmissionCidVerdict = 'parallel-safe' | 'parallel-safe-with-cid-overlap-advisory' | 'blocked-cid-conflict' | 'insufficient-mutation-intent' | 'unknown';
export interface ClaimAdmissionInput {
    readonly brokerVerdict: BrokerArbitrationVerdict;
    readonly cidVerdict: ClaimAdmissionCidVerdict;
    /** Task the admission is being decided for. */
    readonly candidateTaskId: string;
    /** Task currently holding the conflicting resource, if any. */
    readonly conflictingTaskId?: string | null;
    /**
     * Overlapping atom ids (from the parallel-preflight finding). Not used to
     * gate — the broker verdict already accounts for atom overlap — but is
     * echoed back in the decision for diagnostic clarity.
     */
    readonly overlappingAtomIds?: readonly string[];
    readonly ownerComparison?: ClaimOwnerComparison;
}
export interface ClaimAdmissionDecision {
    readonly admitted: boolean;
    readonly blockReason: string | null;
    readonly blockCode: 'ATM_NEXT_CLAIM_BLOCKED' | null;
    readonly divergence: null | {
        readonly code: 'ATM_CLAIM_ADMISSION_BROKER_CID_DIVERGENCE';
        readonly brokerVerdict: BrokerArbitrationVerdict;
        readonly cidVerdict: ClaimAdmissionCidVerdict;
        readonly detail: string;
    };
    readonly advisory: null | {
        readonly kind: 'cid-overlap-advisory' | 'takeover-required';
        readonly detail: string;
    };
    readonly ownerComparison?: ClaimOwnerComparison;
}
export type ClaimOwnerComparisonMode = 'lane-id' | 'actor-fallback';
export interface ClaimLifecycleOwner {
    readonly actorId?: string | null;
    readonly laneSessionId?: string | null;
}
export interface ClaimOwnerComparison {
    readonly schemaId: 'atm.claimOwnerComparison.v1';
    readonly mode: ClaimOwnerComparisonMode;
    readonly sameOwner: boolean;
    readonly currentActorId: string | null;
    readonly conflictingActorId: string | null;
    readonly currentLaneSessionId: string | null;
    readonly conflictingLaneSessionId: string | null;
    readonly reason: string;
}
/**
 * Return true iff the broker verdict is admissible.
 */
export declare function isBrokerVerdictAdmissible(verdict: BrokerArbitrationVerdict): boolean;
/**
 * Compare lifecycle ownership during the lane-session migration.
 * If both sides have lane ids, lane identity is authoritative; otherwise the
 * legacy actor-id comparison remains the fallback.
 */
export declare function compareClaimLifecycleOwners(input: {
    readonly current: ClaimLifecycleOwner;
    readonly conflicting: ClaimLifecycleOwner;
}): ClaimOwnerComparison;
export declare function deriveActiveWriteConflictFromOwnerComparison(input: {
    readonly comparison: ClaimOwnerComparison;
    readonly conflictIntent?: string | null;
}): boolean;
/**
 * Classify whether the broker verdict and the CID diagnostic agree. They
 * "agree" when both would admit or both would block; anything else is
 * divergence and gets a diagnostic (should not happen once this atom is
 * consulted end-to-end; we ship the diagnostic to catch future regressions).
 */
export declare function detectBrokerCidDivergence(brokerVerdict: BrokerArbitrationVerdict, cidVerdict: ClaimAdmissionCidVerdict): boolean;
/**
 * TASK-TEAM-0078 — derive the legacy CID gate verdict from the
 * parallel-preflight finding signals. Extracted from next.ts so the queue/CID
 * policy has a single owner module.
 */
export declare function deriveCidVerdict(input: {
    readonly claimIntent: string;
    readonly activeWriteConflict: boolean;
    readonly confirmedBrokerConflict: boolean;
    readonly insufficientMutationIntent: boolean;
    readonly overlappingAtomIdCount: number;
}): {
    readonly shouldBlockPerCid: boolean;
    readonly cidVerdict: ClaimAdmissionCidVerdict;
};
/**
 * TASK-TEAM-0078 — map the claim-path signals onto the broker arbitration
 * verdict. The parallel-preflight is broker-authoritative for this path:
 * queued private work maps to `watch`, a confirmed CID block maps to
 * `freeze`, anything else the CID gate would admit maps to `allow`.
 */
export declare function deriveBrokerVerdict(input: {
    readonly queuedPrivateWork: boolean;
    readonly shouldBlockPerCid: boolean;
}): BrokerArbitrationVerdict;
/**
 * When a matching broker conflict resolution artifact authorizes the
 * conflicting foreign task id, claim admission must not freeze on CID overlap.
 */
export declare function resolveEffectiveShouldBlockPerCid(input: {
    readonly shouldBlockPerCid: boolean;
    readonly conflictingTaskId?: string | null;
    readonly resolutionAuthorizedForeignTaskIds?: ReadonlySet<string>;
}): boolean;
export declare function evaluateClaimAdmission(input: ClaimAdmissionInput): ClaimAdmissionDecision;

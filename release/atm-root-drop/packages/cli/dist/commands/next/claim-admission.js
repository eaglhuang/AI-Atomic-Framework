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
/**
 * Return true iff the broker verdict is admissible.
 */
export function isBrokerVerdictAdmissible(verdict) {
    return verdict === 'allow' || verdict === 'watch' || verdict === 'takeover';
}
function normalizeOptionalString(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
/**
 * Compare lifecycle ownership during the lane-session migration.
 * If both sides have lane ids, lane identity is authoritative; otherwise the
 * legacy actor-id comparison remains the fallback.
 */
export function compareClaimLifecycleOwners(input) {
    const currentActorId = normalizeOptionalString(input.current.actorId);
    const conflictingActorId = normalizeOptionalString(input.conflicting.actorId);
    const currentLaneSessionId = normalizeOptionalString(input.current.laneSessionId);
    const conflictingLaneSessionId = normalizeOptionalString(input.conflicting.laneSessionId);
    if (currentLaneSessionId && conflictingLaneSessionId) {
        const sameOwner = currentLaneSessionId === conflictingLaneSessionId;
        return {
            schemaId: 'atm.claimOwnerComparison.v1',
            mode: 'lane-id',
            sameOwner,
            currentActorId,
            conflictingActorId,
            currentLaneSessionId,
            conflictingLaneSessionId,
            reason: sameOwner
                ? 'Both lifecycle records carry the same lane id; actor metadata drift is treated as a handoff/adoption within one lane.'
                : 'Both lifecycle records carry lane ids and they differ; ownership is treated as distinct even if actor ids match.'
        };
    }
    const sameOwner = Boolean(currentActorId && conflictingActorId && currentActorId === conflictingActorId);
    return {
        schemaId: 'atm.claimOwnerComparison.v1',
        mode: 'actor-fallback',
        sameOwner,
        currentActorId,
        conflictingActorId,
        currentLaneSessionId,
        conflictingLaneSessionId,
        reason: 'At least one lifecycle record has no lane id, so ATM preserves legacy actor-id ownership comparison.'
    };
}
export function deriveActiveWriteConflictFromOwnerComparison(input) {
    if (input.conflictIntent === 'closeout-only')
        return false;
    const hasConflictingIdentity = input.comparison.mode === 'lane-id'
        ? Boolean(input.comparison.conflictingLaneSessionId)
        : Boolean(input.comparison.conflictingActorId);
    return hasConflictingIdentity && !input.comparison.sameOwner;
}
/**
 * Classify whether the broker verdict and the CID diagnostic agree. They
 * "agree" when both would admit or both would block; anything else is
 * divergence and gets a diagnostic (should not happen once this atom is
 * consulted end-to-end; we ship the diagnostic to catch future regressions).
 */
export function detectBrokerCidDivergence(brokerVerdict, cidVerdict) {
    const brokerAdmits = isBrokerVerdictAdmissible(brokerVerdict);
    const cidBlocks = cidVerdict === 'blocked-cid-conflict';
    const cidAdmits = cidVerdict === 'parallel-safe'
        || cidVerdict === 'parallel-safe-with-cid-overlap-advisory';
    if (brokerAdmits && cidBlocks)
        return true;
    if (!brokerAdmits && cidAdmits)
        return true;
    return false;
}
/**
 * TASK-TEAM-0078 — derive the legacy CID gate verdict from the
 * parallel-preflight finding signals. Extracted from next.ts so the queue/CID
 * policy has a single owner module.
 */
export function deriveCidVerdict(input) {
    const shouldBlockPerCid = input.claimIntent !== 'closeout-only'
        && input.activeWriteConflict
        && (input.confirmedBrokerConflict || input.insufficientMutationIntent);
    const cidVerdict = shouldBlockPerCid
        ? 'blocked-cid-conflict'
        : (input.insufficientMutationIntent
            ? 'insufficient-mutation-intent'
            : input.overlappingAtomIdCount > 0
                ? 'parallel-safe-with-cid-overlap-advisory'
                : 'parallel-safe');
    return { shouldBlockPerCid, cidVerdict };
}
/**
 * TASK-TEAM-0078 — map the claim-path signals onto the broker arbitration
 * verdict. The parallel-preflight is broker-authoritative for this path:
 * queued private work maps to `watch`, a confirmed CID block maps to
 * `freeze`, anything else the CID gate would admit maps to `allow`.
 */
export function deriveBrokerVerdict(input) {
    if (input.queuedPrivateWork)
        return 'watch';
    return input.shouldBlockPerCid ? 'freeze' : 'allow';
}
/**
 * When a matching broker conflict resolution artifact authorizes the
 * conflicting foreign task id, claim admission must not freeze on CID overlap.
 */
export function resolveEffectiveShouldBlockPerCid(input) {
    if (!input.shouldBlockPerCid)
        return false;
    const authorized = input.resolutionAuthorizedForeignTaskIds;
    if (!authorized || authorized.size === 0)
        return true;
    const conflictId = input.conflictingTaskId?.trim().toUpperCase();
    if (conflictId && authorized.has(conflictId))
        return false;
    return true;
}
export function evaluateClaimAdmission(input) {
    const divergent = detectBrokerCidDivergence(input.brokerVerdict, input.cidVerdict);
    const divergence = divergent
        ? {
            code: 'ATM_CLAIM_ADMISSION_BROKER_CID_DIVERGENCE',
            brokerVerdict: input.brokerVerdict,
            cidVerdict: input.cidVerdict,
            detail: `Broker verdict '${input.brokerVerdict}' disagrees with CID gate verdict '${input.cidVerdict}' for ${input.candidateTaskId}. Broker verdict wins; investigate the parallel-preflight discrepancy.`
        }
        : null;
    if (!isBrokerVerdictAdmissible(input.brokerVerdict)) {
        return {
            admitted: false,
            blockCode: 'ATM_NEXT_CLAIM_BLOCKED',
            blockReason: `Broker arbitration returned '${input.brokerVerdict}' (broker-conflict-blocked) - claim cannot proceed while the underlying conflict is unresolved`
                + (input.conflictingTaskId ? ` (conflict with ${input.conflictingTaskId}).` : '.'),
            divergence,
            advisory: null,
            ...(input.ownerComparison ? { ownerComparison: input.ownerComparison } : {})
        };
    }
    let advisory = null;
    if (input.brokerVerdict === 'takeover') {
        advisory = {
            kind: 'takeover-required',
            detail: 'Broker verdict is takeover; lease must be seized before write.'
        };
    }
    else if ((input.overlappingAtomIds?.length ?? 0) > 0) {
        advisory = {
            kind: 'cid-overlap-advisory',
            detail: `Same-atom overlap with ${input.conflictingTaskId ?? 'another task'} is admitted because the broker verdict is '${input.brokerVerdict}'.`
        };
    }
    return {
        admitted: true,
        blockCode: null,
        blockReason: null,
        divergence,
        advisory,
        ...(input.ownerComparison ? { ownerComparison: input.ownerComparison } : {})
    };
}

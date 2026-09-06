import { parseClaimRecord } from "../task-ledger-readers.js";
/**
 * Claim-state semantics used by legacy task import and repair paths.
 *
 * A claim is preservable when it is an active/handoff claim, or when it has
 * any non-released state that must not be silently discarded during migration.
 */
export function hasProtectedActiveClaim(document) {
    if (!document)
        return false;
    const claim = parseClaimRecord(document.claim);
    return Boolean(claim && (claim.state === "active" || claim.state === "handoff"));
}
export function hasPreservableClaimState(document) {
    if (!document)
        return false;
    if (hasProtectedActiveClaim(document))
        return true;
    const claim = document.claim;
    if (!claim || typeof claim !== "object" || Array.isArray(claim))
        return false;
    const state = String(claim.state ?? "").trim();
    return state.length > 0 && state !== "released";
}

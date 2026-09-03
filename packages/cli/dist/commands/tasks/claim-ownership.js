import { compareClaimLifecycleOwners } from '../next/claim-admission.js';
import { resolveLaneSession } from '../lane-session/resolve.js';
import { CliError } from '../shared.js';
export function readClaimLaneSessionId(claim) {
    const laneSessionId = claim?.laneSession?.laneSessionId;
    return typeof laneSessionId === 'string' && laneSessionId.trim() ? laneSessionId.trim() : null;
}
export function evaluateSameTaskClaimOwnership(input) {
    return compareClaimLifecycleOwners({
        current: {
            actorId: input.currentActorId,
            laneSessionId: input.currentLaneSessionId ?? null
        },
        conflicting: {
            actorId: input.requestedActorId,
            laneSessionId: input.requestedLaneSessionId ?? null
        }
    });
}
/**
 * A held active claim remains bound to its lane.  The same actor must reuse
 * that lane for idempotent claim/renew flows; only a different actor may
 * present a distinct lane as a conflicting identity.
 */
export function resolveSameActorClaimLaneSessionId(input) {
    if (input.existingClaimActorId === input.requestedActorId && input.existingClaimLaneSessionId) {
        return input.existingClaimLaneSessionId;
    }
    return input.requestedLaneSessionId ?? null;
}
export function buildSameTaskClaimConflictDetails(input) {
    const holdingLaneSessionId = input.comparison.currentLaneSessionId;
    const requestedLaneSessionId = input.comparison.conflictingLaneSessionId;
    return {
        taskId: input.taskId,
        actorId: input.currentActorId,
        requestedActorId: input.requestedActorId,
        leaseId: input.leaseId ?? null,
        holdingLaneSessionId,
        requestedLaneSessionId,
        ownershipMode: input.comparison.mode,
        ownerComparisonReason: input.comparison.reason,
        laneAdoptCommand: holdingLaneSessionId
            ? `node atm.mjs lane adopt ${holdingLaneSessionId} --actor ${input.requestedActorId} --json`
            : null,
        recoveryHint: holdingLaneSessionId
            ? `Adopt the holding lane (${holdingLaneSessionId}) or hand off before claiming from a different lane.`
            : `Continue with the existing claim owner ${input.currentActorId}, or release/take over the task before claiming as ${input.requestedActorId}.`
    };
}
/**
 * A lifecycle owner comparison can fail either because its actor differs or
 * because the same actor is operating through a different lane.  The latter
 * has a distinct safe recovery (adopt or hand off the holding lane), so it
 * must not be flattened into the generic lock-conflict error.
 */
export function claimOwnershipMismatchCode(comparison, actorFallbackCode = 'ATM_LOCK_CONFLICT') {
    return comparison.mode === 'lane-id'
        ? 'ATM_LANE_SESSION_OWNERSHIP_MISMATCH'
        : actorFallbackCode;
}
export function throwIfForeignSameTaskClaim(input) {
    const comparison = evaluateSameTaskClaimOwnership(input);
    if (comparison.sameOwner)
        return comparison;
    throw new CliError(claimOwnershipMismatchCode(comparison), `Task ${input.taskId} is already claimed by ${input.currentActorId}`
        + (comparison.currentLaneSessionId ? ` on lane ${comparison.currentLaneSessionId}` : '')
        + '.', {
        exitCode: 1,
        details: buildSameTaskClaimConflictDetails({
            taskId: input.taskId,
            currentActorId: input.currentActorId,
            requestedActorId: input.requestedActorId,
            leaseId: input.leaseId,
            comparison
        })
    });
}
// The owner comparison decides ownership on lane ids whenever both lifecycle
// records carry one, and falls back to actor ids only when a lane id is missing.
// The message must name whichever identity actually discriminated, otherwise one
// actor holding a task on an older lane reads "claimed by X, not X" and is sent
// looking for an identity problem that does not exist.
export function describeClaimOwnerMismatch(input) {
    const { comparison } = input;
    if (comparison.mode === 'lane-id' && comparison.currentLaneSessionId && comparison.conflictingLaneSessionId) {
        const sameActor = input.currentActorId === input.requestedActorId;
        return `Task ${input.taskId} is claimed on lane ${comparison.currentLaneSessionId}, not on the requested lane ${comparison.conflictingLaneSessionId}.`
            + (sameActor
                ? ` Actor ${input.currentActorId} holds both sides, so this is a lane mismatch rather than a foreign owner: adopt the holding lane to continue.`
                : ` The holding lane belongs to ${input.currentActorId} and the request came from ${input.requestedActorId}.`);
    }
    return `Task ${input.taskId} is claimed by ${input.currentActorId}, not ${input.requestedActorId}.`;
}
export function throwIfClaimOwnerMismatch(input) {
    const comparison = evaluateSameTaskClaimOwnership(input);
    if (comparison.sameOwner)
        return comparison;
    throw new CliError(claimOwnershipMismatchCode(comparison, 'ATM_TASK_CLAIM_OWNER_MISMATCH'), describeClaimOwnerMismatch({
        taskId: input.taskId,
        currentActorId: input.currentActorId,
        requestedActorId: input.requestedActorId,
        comparison
    }), {
        exitCode: 1,
        details: {
            taskId: input.taskId,
            currentActor: input.currentActorId,
            actorId: input.requestedActorId,
            holdingLaneSessionId: comparison.currentLaneSessionId,
            requestedLaneSessionId: comparison.conflictingLaneSessionId,
            ownershipMode: comparison.mode,
            ownerComparisonReason: comparison.reason,
            laneAdoptCommand: comparison.currentLaneSessionId
                ? `node atm.mjs lane adopt ${comparison.currentLaneSessionId} --actor ${input.requestedActorId} --json`
                : null
        }
    });
}
export function assertCurrentClaimOwnerForAction(input) {
    const holdingLaneSessionId = readClaimLaneSessionId(input.currentClaim);
    const laneSession = resolveLaneSession({
        cwd: input.cwd,
        actorId: input.actorId,
        taskId: input.taskId,
        laneSessionId: resolveSameActorClaimLaneSessionId({
            existingClaimActorId: input.currentClaim.actorId,
            existingClaimLaneSessionId: holdingLaneSessionId,
            requestedActorId: input.actorId
        }),
        command: `node atm.mjs tasks ${input.action} --task ${input.taskId} --actor ${input.actorId} --json`
    });
    throwIfClaimOwnerMismatch({
        taskId: input.taskId,
        currentActorId: input.currentClaim.actorId,
        currentLaneSessionId: readClaimLaneSessionId(input.currentClaim),
        requestedActorId: input.actorId,
        requestedLaneSessionId: laneSession.session.laneId
    });
    return laneSession;
}
export function throwIfNextClaimForeignActiveOwner(input) {
    if (!input.existingClaimActorId)
        return false;
    const ownership = evaluateSameTaskClaimOwnership({
        currentActorId: input.existingClaimActorId,
        currentLaneSessionId: input.existingClaimLaneSessionId,
        requestedActorId: input.requestedActorId,
        requestedLaneSessionId: input.requestedLaneSessionId
    });
    if (ownership.sameOwner)
        return true;
    const recoveryHint = ownership.currentLaneSessionId
        ? `Adopt the holding lane (${ownership.currentLaneSessionId}) or hand off before claiming from a different lane.`
        : input.existingClaimActorId === input.actorResolution.repoDefaultActorId
            ? `Continue with the existing claim owner ${input.existingClaimActorId}, or rerun with --actor ${input.existingClaimActorId}.`
            : `Continue with the existing claim owner ${input.existingClaimActorId}, or release/take over the task before claiming as ${input.requestedActorId}.`;
    throw new CliError(claimOwnershipMismatchCode(ownership), `Task ${input.taskId} is already claimed by ${input.existingClaimActorId}`
        + (ownership.currentLaneSessionId ? ` on lane ${ownership.currentLaneSessionId}` : '')
        + '.', {
        exitCode: 1,
        details: {
            ...buildSameTaskClaimConflictDetails({
                taskId: input.taskId,
                currentActorId: input.existingClaimActorId,
                requestedActorId: input.requestedActorId,
                comparison: ownership
            }),
            actorResolution: input.actorResolution,
            recoveryHint
        }
    });
}

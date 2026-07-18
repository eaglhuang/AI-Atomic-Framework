import { resolveActorWorkSession } from '../actor-session.js';
import { message } from '../shared.js';
export function buildClaimedMessage(input) {
    return message('info', 'ATM_NEXT_CLAIMED', 'Claimed the next imported work item.', {
        taskId: input.taskId,
        actorId: input.actorId,
        actorSource: input.actorSource,
        actorResolution: input.actorResolution,
        recommendedChannel: input.recommendedChannel,
        claimIntent: input.claimIntent,
        batchCheckpointCommand: input.recommendedChannel === 'batch'
            ? 'node atm.mjs batch checkpoint --actor <id> --json'
            : null,
        blockedPattern: input.recommendedChannel === 'batch' ? 'manual tasks claim/close loop' : null,
        ignoredUntrackedFiles: input.ignoredUntrackedFiles,
        ignoredUntrackedNote: input.ignoredUntrackedFiles.length > 0
            ? 'These files are NOT blocking the claim. If any of them is actually a deliverable for this task, run `node atm.mjs tasks scope --add <paths>` to widen the scope and then `git add` them.'
            : null
    });
}
export function resolveCurrentLaneSessionIdForFreshReservation(cwd, actorId) {
    return normalizeOptionalLaneSessionId(process.env.ATM_LANE_SESSION_ID)
        ?? normalizeOptionalLaneSessionId(resolveActorWorkSession(cwd, { actorId })?.guidanceSessionId);
}
export function normalizeClaimLaneSessionEnvelope(value) {
    if (!value)
        return null;
    const laneSessionId = typeof value.laneSessionId === 'string' ? value.laneSessionId.trim() : '';
    const status = typeof value.status === 'string' ? value.status.trim() : '';
    const source = typeof value.source === 'string' ? value.source.trim() : '';
    const exportHint = typeof value.exportHint === 'string' ? value.exportHint.trim() : '';
    if (!laneSessionId || !status || !source || !exportHint)
        return null;
    return { laneSessionId, status, source, exportHint };
}
function normalizeOptionalLaneSessionId(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function normalizeLaneScopePath(value) {
    return value.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1').replace(/\\/g, '/');
}
export function normalizeLaneScopePaths(values) {
    return Array.from(new Set(values.map(normalizeLaneScopePath).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}
export function buildLaneLifecycleReconcileCommand(input) {
    return [
        'node',
        'atm.mjs',
        'tasks',
        'repair-claim',
        '--task',
        quoteCliValue(input.taskId),
        '--actor',
        quoteCliValue(input.actorId),
        '--write',
        '--reason',
        quoteCliValue(input.reason),
        '--json'
    ].join(' ');
}
export function evaluateLaneLifecycleMismatch(input) {
    const currentLane = normalizeOptional(input.current.laneSessionId);
    const requestedLane = normalizeOptional(input.requested.laneSessionId);
    if (currentLane && requestedLane) {
        const sameOwner = currentLane === requestedLane;
        return {
            sameOwner,
            mode: 'lane-id',
            requiredCommand: sameOwner
                ? null
                : buildLaneLifecycleReconcileCommand({
                    taskId: input.taskId,
                    actorId: input.actorId,
                    reason: `reconcile lane mismatch ${currentLane} -> ${requestedLane}`
                })
        };
    }
    const currentActor = normalizeOptional(input.current.actorId);
    const requestedActor = normalizeOptional(input.requested.actorId);
    const sameOwner = Boolean(currentActor && requestedActor && currentActor === requestedActor);
    return {
        sameOwner,
        mode: 'actor-fallback',
        requiredCommand: sameOwner
            ? null
            : buildLaneLifecycleReconcileCommand({
                taskId: input.taskId,
                actorId: input.actorId,
                reason: `reconcile actor mismatch ${currentActor ?? 'unknown'} -> ${requestedActor ?? 'unknown'}`
            })
    };
}
function normalizeOptional(value) {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function quoteCliValue(value) {
    return /^[A-Za-z0-9._:/-]+$/.test(value)
        ? value
        : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

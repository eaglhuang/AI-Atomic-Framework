function normalizeText(value) {
    const text = typeof value === 'string' ? value.trim() : '';
    return text.length > 0 ? text : null;
}
function valuesMatch(left, right) {
    const leftText = normalizeText(left);
    const rightText = normalizeText(right);
    return leftText !== null && rightText !== null && leftText === rightText;
}
function isCurrentTaskActiveLock(lock, taskId, actorId) {
    const lockActorId = normalizeText(lock.actorId);
    const currentActorId = normalizeText(actorId);
    const actorMatches = currentActorId === null || lockActorId === null || lockActorId === currentActorId;
    return lock.kind === 'still-active'
        // A temporary framework claim has two legitimate identifiers: the
        // temporary work item that owns the lock and the task it is linked to.
        // Commit admission uses the former, whereas lifecycle diagnostics often
        // use the latter.  Both identify the same authoritative lock; preferring
        // one with `??` made a live temporary claim unable to authorize itself.
        && (valuesMatch(lock.lockTaskId, taskId) || valuesMatch(lock.linkedTaskId, taskId))
        && actorMatches;
}
/**
 * Removes only a current task's own active framework lock from stale-lock
 * diagnostics. The lock remains authoritative until that task reaches its
 * terminal transition; this context simply prevents a task from requiring
 * its own terminal transition before it may perform that transition.
 */
export function buildTaskFrameworkLockContext(input) {
    const staleLocks = input.staleLocks.filter((lock) => !isCurrentTaskActiveLock(lock, input.taskId, input.actorId));
    const blockers = input.blockers.filter((blocker) => blocker !== 'framework-stale-lock-cleanup-required'
        || input.staleLocks.length === 0
        || staleLocks.length > 0);
    return { blockers, staleLocks };
}

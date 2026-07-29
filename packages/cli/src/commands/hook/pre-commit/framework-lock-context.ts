// @ts-nocheck

function normalizeText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > 0 ? text : null;
}

function taskIdsMatch(left: unknown, right: unknown): boolean {
  const leftText = normalizeText(left);
  const rightText = normalizeText(right);
  return leftText !== null && rightText !== null && leftText === rightText;
}

function actorIdsMatch(lockActorId: unknown, commitActorId: unknown): boolean {
  const lockActor = normalizeText(lockActorId);
  const commitActor = normalizeText(commitActorId);
  return commitActor === null || lockActor === null || lockActor === commitActor;
}

function isCurrentCommitTaskActiveLock(staleLock: any, commitTaskId: unknown, commitActorId: unknown): boolean {
  return staleLock?.kind === 'still-active'
    && taskIdsMatch(staleLock.linkedTaskId ?? staleLock.lockTaskId, commitTaskId)
    && actorIdsMatch(staleLock.actorId, commitActorId);
}

export function buildCommitTaskFrameworkLockContext(input: {
  readonly blockers: readonly string[];
  readonly staleLocks: readonly any[];
  readonly commitTaskId: unknown;
  readonly commitActorId: unknown;
}): { readonly blockers: readonly string[]; readonly staleLocks: readonly any[] } {
  const staleLocks = input.staleLocks.filter((lock) => !isCurrentCommitTaskActiveLock(lock, input.commitTaskId, input.commitActorId));
  const blockers = input.blockers.filter((blocker) => {
    if (blocker !== 'framework-stale-lock-cleanup-required') return true;
    return input.staleLocks.length === 0 || staleLocks.length > 0;
  });
  return { blockers, staleLocks };
}

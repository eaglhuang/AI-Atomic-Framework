import { buildTaskFrameworkLockContext, type FrameworkLockCandidate } from '../../framework-development/framework-lock-context.ts';

export function buildCommitTaskFrameworkLockContext(input: {
  readonly blockers: readonly string[];
  readonly staleLocks: readonly FrameworkLockCandidate[];
  readonly commitTaskId: unknown;
  readonly commitActorId: unknown;
}): { readonly blockers: readonly string[]; readonly staleLocks: readonly FrameworkLockCandidate[] } {
  return buildTaskFrameworkLockContext({
    blockers: input.blockers,
    staleLocks: input.staleLocks,
    taskId: input.commitTaskId,
    actorId: input.commitActorId
  });
}

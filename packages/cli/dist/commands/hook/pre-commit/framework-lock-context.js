import { buildTaskFrameworkLockContext } from '../../framework-development/framework-lock-context.js';
export function buildCommitTaskFrameworkLockContext(input) {
    return buildTaskFrameworkLockContext({
        blockers: input.blockers,
        staleLocks: input.staleLocks,
        taskId: input.commitTaskId,
        actorId: input.commitActorId
    });
}

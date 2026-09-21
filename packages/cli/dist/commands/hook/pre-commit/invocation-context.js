import path from 'node:path';
import { inferTaskIdsFromStagedFiles } from './support.js';
import { readStagedFiles } from './input-state.js';
export function resolvePreCommitInvocationContext(cwd) {
    const root = path.resolve(cwd);
    const explicitCommittingTaskId = typeof process.env.ATM_COMMIT_TASK_ID === 'string'
        ? process.env.ATM_COMMIT_TASK_ID.trim()
        : null;
    const stagedTaskIdsForContext = (explicitCommittingTaskId
        ? []
        : inferTaskIdsFromStagedFiles(readStagedFiles(root)));
    const committingTaskIdForHook = explicitCommittingTaskId
        || (stagedTaskIdsForContext.length === 1 ? stagedTaskIdsForContext[0] : null);
    const scopedIndexActive = typeof process.env.GIT_INDEX_FILE === 'string'
        && process.env.GIT_INDEX_FILE.trim().length > 0;
    return {
        root,
        explicitCommittingTaskId,
        stagedTaskIdsForContext,
        committingTaskIdForHook,
        scopedIndexActive
    };
}

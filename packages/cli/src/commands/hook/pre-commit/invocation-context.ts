import path from 'node:path';

import { inferTaskIdsFromStagedFiles } from './support.ts';
import { readStagedFiles } from './input-state.ts';

export interface PreCommitInvocationContext {
  root: string;
  explicitCommittingTaskId: string | null;
  stagedTaskIdsForContext: string[];
  committingTaskIdForHook: string | null;
  scopedIndexActive: boolean;
}

export function resolvePreCommitInvocationContext(cwd: string): PreCommitInvocationContext {
  const root = path.resolve(cwd);
  const explicitCommittingTaskId = typeof process.env.ATM_COMMIT_TASK_ID === 'string'
    ? process.env.ATM_COMMIT_TASK_ID.trim()
    : null;
  const stagedTaskIdsForContext = (explicitCommittingTaskId
    ? []
    : inferTaskIdsFromStagedFiles(readStagedFiles(root))) as string[];
  const committingTaskIdForHook: string | null = explicitCommittingTaskId
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

type LegacyValue = ReturnType<typeof JSON.parse>;
export declare function inspectCloseCommitWindowStagedArtifacts(cwd: LegacyValue, taskId: LegacyValue): {
    ok: boolean;
    taskId: any;
    stagedFiles: string[];
    reason: string;
} | {
    ok: boolean;
    taskId: any;
    stagedFiles: string[];
    reason: null;
};
export declare function readStagedJsonFile(cwd: LegacyValue, relativeFile: LegacyValue): any;
export declare function readStagedFiles(cwd: LegacyValue): string[];
/**
 * Read tracked worktree changes independently of staged state. A path may be
 * both staged and unstaged (`MM`); callers that implement auto-stage must keep
 * that path in the worktree overlay instead of treating the staged entry as
 * authoritative.
 */
export declare function readUnstagedFiles(cwd: LegacyValue): string[];
export declare function rollbackNewlyStagedLiveIndexResidue(cwd: LegacyValue, stagedBeforeAttempt: LegacyValue): string[];
export declare function readStagedDiffNames(cwd: LegacyValue, diffFilter: LegacyValue): string[];
export declare function isAllowedGovernanceArtifactPath(cwd: LegacyValue, filePath: LegacyValue, taskId: LegacyValue): boolean;
export declare function isFileAllowedInTaskBundle(cwd: LegacyValue, filePath: LegacyValue, taskId: LegacyValue, declaredScope: LegacyValue): boolean;
export declare function buildHostGitCompatibilityGuidance(input: LegacyValue): string;
export declare function buildCopyableGitCommitCommand(input: LegacyValue): string;
export declare function buildUnexpectedStagedTasksForGitCommit(cwd: LegacyValue, taskId: LegacyValue, declaredScope: LegacyValue, stagedFiles: LegacyValue): {
    taskId: any;
    stagedFiles: readonly string[];
    restoreChoice: string;
    deferCommand: string;
}[];
export declare function inferActiveTaskOwnerForPath(cwd: LegacyValue, filePath: LegacyValue): any;
export declare function readProtectedOverrideAuditTaskId(cwd: LegacyValue, filePath: LegacyValue): any;
export declare function listExistingGovernanceFilesRecursively(root: LegacyValue, relativeDirectory: LegacyValue): string[];
export declare function listTaskOwnedProtectedOverrideAuditFiles(cwd: LegacyValue, taskId: LegacyValue): string[];
export declare function buildProtectedForeignStagedOwnershipFiles(unexpectedStagedTasks: LegacyValue): readonly string[];
export declare function isActiveForeignGovernanceResidueOwner(cwd: LegacyValue, taskId: LegacyValue, finding: LegacyValue): boolean;
export declare function deferForeignStagedFiles(cwd: LegacyValue, taskId: LegacyValue, unexpectedStagedTasks: LegacyValue): string | null;
export declare function deferStagedFilePaths(cwd: LegacyValue, taskId: LegacyValue, filesInput: LegacyValue): string | null;
export declare function cleanupDeferredForeignStagedSnapshot(cwd: LegacyValue, snapshotPath: LegacyValue): any;
export declare function recordGitIndexRestoreFailure(cwd: LegacyValue, input: LegacyValue): string;
/**
 * The candidate index is assembled from a sealed bundle and asserted against it
 * before `run` may create a commit. An empty bundle is not a licence to commit
 * the live shared index, and neither is an absent one: the caller passes the
 * seal source it decided on, and an unnamed source fails closed.
 *
 * The commit result is returned alongside the live-index reconciliation rather
 * than in place of it. Reconciliation is the postcondition that decides whether
 * the shared index is actually clean afterwards, so a caller that only ever
 * sees the commit result cannot tell a clean index from one holding retained
 * paths it does not own.
 */
export declare function withTaskScopedCommitIndex(cwd: LegacyValue, files: LegacyValue, actorId: LegacyValue, taskId: LegacyValue, run: LegacyValue, sealSource: LegacyValue): {
    result: unknown;
    liveIndexReconciliation: import("./live-index-reconciliation.ts").LiveIndexReconciliation;
    liveIndexReconciliationRecordPath: string | null;
};
export declare function stageTaskScopedBundleFiles(cwd: LegacyValue, files: LegacyValue, env: LegacyValue): void;
export {};

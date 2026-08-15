export declare const GIT_INDEX_LOCK_RECOVERY_FLAG = "--force-index-lock-recovery";
export interface GitIndexLockInspection {
    readonly lockPath: string;
    readonly exists: boolean;
    readonly ageMs: number | null;
    readonly sizeBytes: number | null;
}
export declare function inspectGitIndexLock(cwd: string, nowMs?: number): GitIndexLockInspection;
/**
 * The emergency gate establishes human authority; this module deliberately
 * owns only the filesystem transition and its observable before/after state.
 */
export declare function recoverGitIndexLock(input: {
    readonly cwd: string;
    readonly force: boolean;
    readonly dryRun: boolean;
    readonly nowMs?: number;
}): {
    action: "already-absent";
    before: GitIndexLockInspection;
    after: GitIndexLockInspection;
} | {
    action: "would-remove";
    before: GitIndexLockInspection;
    after: GitIndexLockInspection;
} | {
    action: "removed";
    before: GitIndexLockInspection;
    after: GitIndexLockInspection;
};

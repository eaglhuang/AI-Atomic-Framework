export declare const CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID = "atm.closeWindowStagedIndexLock.v1";
export type CloseWindowStagedIndexLockOutcome = 'committed' | 'rolled_back' | 'aborted';
export interface CloseWindowForeignStagedTaskReport {
    readonly taskId: string;
    readonly stagedFiles: readonly string[];
    readonly restoreChoice: string;
    readonly deferCommand: string;
}
export interface CloseWindowStagedIndexLockRecord {
    readonly schemaId: typeof CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly taskId: string;
    readonly actorId: string;
    readonly acquiredAt: string;
    readonly status: 'active' | 'released';
    readonly expectedStageFiles: readonly string[];
    readonly foreignStagedSnapshotPath: string | null;
    readonly unexpectedStagedTasks: readonly CloseWindowForeignStagedTaskReport[];
    readonly releasedAt: string | null;
    readonly releaseOutcome: CloseWindowStagedIndexLockOutcome | null;
}
export interface CloseWindowStagedIndexLockReport {
    readonly schemaId: typeof CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID;
    readonly ok: boolean;
    readonly lockPath: string | null;
    readonly lock: CloseWindowStagedIndexLockRecord | null;
    readonly unexpectedStagedTasks: readonly CloseWindowForeignStagedTaskReport[];
    readonly foreignStagedSnapshotPath: string | null;
    readonly blockedCode: string | null;
    readonly blockedSummary: string | null;
}
export declare function inspectForeignStagedTasksForCloseWindow(input: {
    cwd: string;
    taskId: string;
    expectedStageFiles: readonly string[];
}): CloseWindowForeignStagedTaskReport[];
export declare function acquireCloseWindowStagedIndexLock(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    expectedStageFiles: readonly string[];
    deferForeignStaged?: boolean;
}): CloseWindowStagedIndexLockReport;
export declare function assertCloseWindowStagingAllowed(input: {
    cwd: string;
    taskId: string;
    operation: string;
}): void;
export declare function releaseCloseWindowStagedIndexLock(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    outcome: CloseWindowStagedIndexLockOutcome;
}): CloseWindowStagedIndexLockRecord | null;
export declare function readCloseWindowStagedIndexLockReport(cwd: string): CloseWindowStagedIndexLockRecord | null;

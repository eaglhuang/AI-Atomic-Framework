type LegacyValue = ReturnType<typeof JSON.parse>;
export declare function isRecordCommitAllowedPath(filePath: LegacyValue): boolean;
export declare function extractRecordCommitTaskOwner(filePath: LegacyValue): string | null;
export declare function assertRecordCommitSingleTaskOwner(cwd: LegacyValue, stagedFiles: LegacyValue): null;
export declare function inspectMirrorSyncOnlyStagedArtifacts(cwd: LegacyValue, taskId: LegacyValue): {
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
export declare function inspectHistoricalLedgerRestoreStagedArtifacts(cwd: LegacyValue, taskId: LegacyValue): {
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
export {};

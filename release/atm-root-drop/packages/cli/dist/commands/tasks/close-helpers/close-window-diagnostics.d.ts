export interface HistoricalBatchCloseSlice {
    readonly batchId: string;
    readonly batchPath: string;
    readonly ok: boolean;
    readonly matchedCommits: readonly string[];
    readonly matchedFiles: readonly string[];
    readonly coverageStatus: 'complete' | 'partial' | 'blocked';
    readonly okToRecordEvidence: boolean;
    readonly okToCloseTask: boolean;
    readonly diagnosticOnly: boolean;
    readonly missingCoverage: readonly string[];
    readonly taskSpecificValidationPasses: readonly string[];
    readonly batchWideValidationPasses: readonly string[];
    readonly advisoryValidationPasses: readonly string[];
}
export declare function readDeferredForeignStagedFilesForActiveCloseWindow(cwd: string, taskId: string): string[];
export declare function evaluateFrameworkDeliveryWindow(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly batchId: string | null;
    readonly fromBatchCheckpoint: boolean;
    readonly taskDeclaredFiles: readonly string[];
    readonly criticalChangedFiles: readonly string[];
    readonly historicalDeliveryRefs: readonly string[];
    readonly historicalBatchCloseReady?: boolean;
}): {
    schemaId: string;
    taskId: string;
    batchId: string | null;
    ok: boolean;
    reason: string;
    criticalChangedFiles: readonly string[];
    scopedCriticalChangedFiles: string[];
    unscopedCriticalChangedFiles: string[];
    declaredFiles: readonly string[];
    historicalDeliveryRefs: readonly string[];
    allowedBlockers: string[];
    requiredCommand: string;
    remediation: string;
};
export declare function loadHistoricalBatchCloseSlice(cwd: string, taskId: string, batchRef: string): HistoricalBatchCloseSlice;

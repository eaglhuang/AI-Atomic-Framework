export { inspectProtectedAtmStateChanges, isUnconsumedCloseWindowDeferralSnapshot } from './support.ts';
export declare function authorizeBlockLifecycleRecordBridge(root: string, crossTaskBlock: {
    readonly conflictFiles: readonly string[];
}): {
    readonly authorized: boolean;
    readonly reason: string;
};
export declare function runPreCommitHook(cwd: string): import("../../shared.ts").CommandResult;

import type { InternalReleaseSyncOptions, SyncTargetReport } from './types.ts';
export declare function syncTarget(input: {
    readonly repo: string;
    readonly options: InternalReleaseSyncOptions;
    readonly sourceRunnerPath: string;
    readonly sourceSha256: string;
    readonly sourceCommit: string | null;
    readonly runId: string;
    readonly skipMatcher: (repoPath: string) => string | null;
}): SyncTargetReport;

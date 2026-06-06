interface InternalReleaseSyncOptions {
    readonly cwd: string;
    readonly repos: readonly string[];
    readonly skips: readonly string[];
    readonly build: boolean;
    readonly dryRun: boolean;
    readonly verify: boolean;
    readonly allowVerifyFailure: boolean;
    readonly source: string | null;
    readonly keepTemp: boolean;
}
interface CommandRunRecord {
    readonly command: string;
    readonly cwd: string;
    readonly exitCode: number;
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
    readonly ok: boolean;
}
interface SyncTargetReport {
    readonly repo: string;
    readonly repoName: string;
    readonly skipped: boolean;
    readonly skipReason: string | null;
    readonly ok: boolean;
    readonly runnerPath: string;
    readonly metadataPath: string;
    readonly previousSha256: string | null;
    readonly newSha256: string | null;
    readonly backupPath: string | null;
    readonly verification: readonly CommandRunRecord[];
    readonly warnings: readonly string[];
    readonly scratchGuard: ScratchGuardReport;
}
interface ScratchGuardReport {
    readonly forbiddenRelativePaths: readonly string[];
    readonly present: readonly string[];
    readonly removed: readonly string[];
    readonly kept: readonly string[];
    readonly fileCount: number;
    readonly freedBytes: number;
    readonly dryRun: boolean;
    readonly keepTemp: boolean;
    readonly errors: readonly string[];
    readonly ok: boolean;
}
export declare function runInternalRelease(argv: string[]): import("./shared.ts").CommandResult;
export declare function runInternalReleaseSync(options: InternalReleaseSyncOptions): {
    schemaId: string;
    specVersion: string;
    generatedAt: string;
    runId: string;
    frameworkRoot: string;
    sourceRunnerPath: string;
    sourceSha256: string;
    sourceCommit: string | null;
    build: CommandRunRecord | null;
    dryRun: boolean;
    verify: boolean;
    allowVerifyFailure: boolean;
    keepTemp: boolean;
    targets: SyncTargetReport[];
    syncedCount: number;
    skippedCount: number;
    failedTargets: string[];
    ok: boolean;
};
export {};

export declare function defaultStewardApplyQueueRoot(cwd?: string): string;
export declare function stewardApplyQueueDirectory(queueRoot: string, targetPath: string): string;
export declare function setStewardApplyQueueOpenFaultForTests(error: unknown | null): void;
export interface StewardCommitControls {
    readonly lockRoot: string;
    readonly lockWaitMs: number;
    readonly lockPollMs: number;
    readonly maxRecomposeAttempts: number;
    readonly recomposeBackoffMs: number;
    readonly recomposeJitterMs: number;
    readonly applyQueue: boolean;
    readonly applyQueueRoot: string;
    readonly applyQueueWaitMs: number;
}
/**
 * 顯式參數蓋過環境變數，環境變數蓋過 stewardCanonicalCommitPolicy。
 * 沒有「關掉檔案鎖」的開關；要消融鎖的共享範圍，改 ATM_STEWARD_COMMIT_LOCK_ROOT。
 */
export declare function resolveStewardCommitControls(input: {
    readonly cwd: string;
    readonly commitLockRoot?: string;
    readonly recomposePolicy?: {
        readonly maxRecomposeAttempts?: number;
        readonly recomposeBackoffMs?: number;
        readonly recomposeJitterMs?: number;
    };
    readonly applyQueue?: boolean;
    readonly applyQueueRoot?: string;
    readonly applyQueueWaitMs?: number;
}): StewardCommitControls;
export declare function withStewardApplyQueue<T>(input: {
    readonly cwd: string;
    readonly targetPaths: readonly string[];
    readonly enabled: boolean;
    readonly queueRoot?: string;
    readonly waitMs: number;
    readonly pollMs: number;
}, fn: () => T): T;

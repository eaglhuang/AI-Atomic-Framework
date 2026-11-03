export declare class StewardLockTimeoutError extends Error {
    readonly filePath: string;
    constructor(filePath: string, holderPid: number | null, waitMs: number);
}
export declare function acquireKernelAdvisoryLock(lockDir: string, waitMs: number, pollMs: number, filePath: string): void;
export declare function releaseKernelAdvisoryLock(lockDir: string): void;
/**
 * 試著立刻取得這把鎖。取得得到代表沒有活著的持有者（含其他 PID namespace）。
 * 呼叫端會馬上 COMMIT，不會把鎖留著。看不出來時回 null，呼叫端不得把持有者當成已死。
 */
export declare function kernelAdvisoryLockIsFree(dbPath: string): boolean | null;

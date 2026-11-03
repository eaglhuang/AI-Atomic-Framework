/**
 * Cross-process canonical commit policy.
 * Compose and validation stay outside this boundary. The lock covers only the
 * base-hash compare and the atomic rename.
 */
export declare const stewardCanonicalCommitPolicy: {
    readonly schemaId: "atm.stewardCanonicalCommitPolicy.v1";
    readonly lockWaitMs: 2000;
    readonly lockPollMs: 5;
    /** Extra compose attempts after the first. Each attempt ends applied, blocked, rolled-back, re-compose, or recovery-required. */
    readonly maxRecomposeAttempts: 4;
    readonly recomposeBackoffMs: 4;
    readonly recomposeJitterMs: 3;
    /** Per-target apply queue in front of the file lock. `off` leaves the file lock as the only serializer. */
    readonly applyQueue: "on";
    readonly applyQueueWaitMs: 10000;
};
/** attempt 從 1 起算。backoff 隨次數增加，jitter 含 0。 */
export declare function stewardRecomposeDelayMs(attempt: number, backoffMs: number, jitterMs: number): number;
export declare function waitStewardRecomposeBackoff(attempt: number, backoffMs: number, jitterMs: number): void;
export type StewardCommitFault = {
    readonly kind: 'before-rename';
} | {
    readonly kind: 'partial-temp';
    readonly byteCount: number;
};
export interface CanonicalCommitEntry {
    readonly filePath: string;
    readonly targetPath: string;
    readonly expectedBaseHash: string;
    readonly content: string;
    readonly outputHash: string;
}
export interface CanonicalCommitFileReceipt {
    readonly filePath: string;
    readonly beforeHash: string;
    readonly afterHash: string;
    readonly outputHash: string;
}
export interface CanonicalCommitResult {
    readonly status: 'applied' | 're-compose' | 'recovery-required' | 'rolled-back';
    readonly reason: string;
    readonly failedFile: string | null;
    readonly restoredFiles: readonly string[];
    readonly files: readonly CanonicalCommitFileReceipt[];
}
/**
 * 鎖放在儲存庫的 ATM 狀態目錄，讓不同 TMPDIR 或容器共用同一份工作樹。
 * 未給 cwd 時用 process.cwd()。
 */
export declare function defaultStewardCommitLockRoot(cwd?: string): string;
export declare function stewardCommitTargetKey(targetPath: string): string;
export declare function canonicalCommitLockPath(lockRoot: string, targetPath: string): string;
/**
 * Commit composed bytes only when every target still matches its compose base.
 * A mismatch returns `re-compose` and does not write. A temp-file failure
 * leaves the canonical file untouched.
 */
export declare function commitCanonicalFiles(input: {
    readonly entries: readonly CanonicalCommitEntry[];
    readonly cwd?: string;
    readonly lockRoot?: string;
    readonly lockWaitMs?: number;
    readonly lockPollMs?: number;
    readonly failAfterWrites?: number;
    readonly commitFault?: StewardCommitFault;
    /** 測試用。鎖已取得、改名之前呼叫。行程被殺掉時，核心層建議鎖會隨檔案描述子放開。 */
    readonly whileLocked?: () => void;
}): CanonicalCommitResult;
/** 測試用。握住核心層建議鎖直到呼叫端放開。pid 檔不會讓這把鎖被別人搶走。 */
export declare function holdCanonicalCommitLock(lockDir: string, filePath?: string): () => void;
/**
 * 只在自己拿到排他鎖時刪暫存檔。拿不到鎖代表寫入者還活著（含其他 PID namespace），一個都不刪。
 */
export declare function cleanupOrphanCanonicalTemps(input: {
    readonly targetPath: string;
    readonly cwd?: string;
    readonly lockRoot?: string;
}): {
    readonly removed: readonly string[];
    readonly skippedLiveHolder: boolean;
};

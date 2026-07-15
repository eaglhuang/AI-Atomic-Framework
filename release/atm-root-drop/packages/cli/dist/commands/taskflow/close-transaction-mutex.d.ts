export interface CloseTransactionMutexLease {
    readonly schemaId: 'atm.closeTransactionMutexLease.v1';
    readonly taskId: string;
    readonly actorId: string;
    readonly leaseId: string;
    readonly ownerPid?: number;
    readonly acquiredAt: string;
    readonly expiresAt: string;
    readonly ttlMs: number;
    readonly ttlReason: string;
    readonly lockPath: string;
}
export interface AcquireCloseTransactionMutexOptions {
    readonly repoRoot: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly ttlMs?: number;
    readonly nowMs?: number;
}
export declare const GOVERNED_GIT_COMMIT_DEFAULT_TIMEOUT_MS = 420000;
export declare const CLOSE_TRANSACTION_MUTEX_SAFETY_MARGIN_MS = 30000;
export declare const DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS: number;
export declare const DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_REASON = "covers governed git commit timeout plus close transaction safety margin";
export declare function closeTransactionMutexPath(repoRoot: string, taskId: string): string;
export declare function acquireCloseTransactionMutex(options: AcquireCloseTransactionMutexOptions): CloseTransactionMutexLease;
export declare function releaseCloseTransactionMutex(lease: CloseTransactionMutexLease): void;
export declare function withCloseTransactionMutex<T>(options: AcquireCloseTransactionMutexOptions, action: (lease: CloseTransactionMutexLease) => Promise<T> | T): Promise<T>;

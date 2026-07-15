export interface CloseTransactionMutexLease {
    readonly schemaId: 'atm.closeTransactionMutexLease.v1';
    readonly taskId: string;
    readonly actorId: string;
    readonly leaseId: string;
    readonly ownerPid?: number;
    readonly acquiredAt: string;
    readonly expiresAt: string;
    readonly lockPath: string;
}
export interface AcquireCloseTransactionMutexOptions {
    readonly repoRoot: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly ttlMs?: number;
    readonly nowMs?: number;
}
export declare const DEFAULT_CLOSE_TRANSACTION_MUTEX_TTL_MS = 120000;
export declare function closeTransactionMutexPath(repoRoot: string, taskId: string): string;
export declare function acquireCloseTransactionMutex(options: AcquireCloseTransactionMutexOptions): CloseTransactionMutexLease;
export declare function releaseCloseTransactionMutex(lease: CloseTransactionMutexLease): void;
export declare function withCloseTransactionMutex<T>(options: AcquireCloseTransactionMutexOptions, action: (lease: CloseTransactionMutexLease) => Promise<T> | T): Promise<T>;

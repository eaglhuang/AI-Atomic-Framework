export declare const claimShareRegistryRelativePath: string;
export declare const claimShareLockRelativePath: string;
export declare const defaultClaimTtlSeconds = 900;
export interface ShareClaim {
    readonly claimId: string;
    readonly actorId: string;
    readonly files: readonly string[];
    readonly source: 'claim' | 'unclaimed-write';
    readonly claimedAt: string;
    readonly renewedAt: string;
    readonly expiresAt: string;
    readonly ttlSeconds: number;
}
export interface PendingOverlapNotice {
    readonly noticeId: string;
    readonly holderActorId: string;
    readonly holderClaimId: string;
    readonly files: readonly string[];
    readonly createdAt: string;
    readonly causeSeq: number;
}
export interface ClaimShareRegistry {
    readonly schemaId: 'atm.claimShareRegistry.v1';
    nextSeq: number;
    nextClaimNumber: number;
    claims: ShareClaim[];
    pendingNotices: PendingOverlapNotice[];
}
export declare function claimShareRegistryPath(cwd: string): string;
export declare function isClaimShareActive(cwd: string): boolean;
export declare function emptyClaimShareRegistry(): ClaimShareRegistry;
export declare function loadClaimShareRegistry(cwd: string): ClaimShareRegistry;
export declare function saveClaimShareRegistry(cwd: string, registry: ClaimShareRegistry): void;
/** Runs `fn` under the cross-process kernel advisory lock that guards both the registry and the event log. */
export declare function withClaimShareLock<T>(cwd: string, fn: () => T): T;

import type { ScopeLockRecord } from '../index';
export type ScopeLeaseRunMode = 'real-agent' | 'editor-subagent' | 'broker-only';
export type ScopeLeaseStatus = 'active' | 'released';
export interface ScopeLeaseOwnerKey {
    readonly instanceId: string;
    readonly worktreeId: string;
}
export interface ScopeLeaseRegistryEntry {
    readonly leaseId: string;
    readonly taskId: string;
    readonly resourceKey: string;
    readonly owner: ScopeLeaseOwnerKey;
    readonly runMode: ScopeLeaseRunMode;
    readonly leaseEpoch: number;
    readonly status: ScopeLeaseStatus;
    readonly allowedFiles: readonly string[];
    readonly writeSet: readonly string[];
    readonly waitsFor?: readonly string[];
    readonly releasedAt?: string;
}
export interface ScopeLeaseFencingFinding {
    readonly code: 'ATM_SCOPE_LEASE_DUPLICATE_EXCLUSIVE_OWNER' | 'ATM_SCOPE_LEASE_STALE_EPOCH' | 'ATM_SCOPE_LEASE_WAIT_FOR_CYCLE' | 'ATM_SCOPE_LEASE_TOMBSTONE_REACQUIRE' | 'ATM_SCOPE_LEASE_ALLOWED_FILES_VIOLATION';
    readonly detail: string;
    readonly leaseIds: readonly string[];
    readonly expectedEpoch?: number;
    readonly actualEpoch?: number;
    readonly runModes: readonly ScopeLeaseRunMode[];
}
export interface ScopeLeaseFencingResult {
    readonly ok: boolean;
    readonly findings: readonly ScopeLeaseFencingFinding[];
}
export declare function createScopeLockRecord(input: any): ScopeLockRecord;
export declare function parseScopeLockRecord(document: any): ScopeLockRecord;
export declare function hasMapSelectors(scopeLock: ScopeLockRecord): boolean;
export declare function validateScopeLeaseFencing(entries: readonly ScopeLeaseRegistryEntry[]): ScopeLeaseFencingResult;
export declare function validateScopeLeaseEpoch(input: {
    readonly leaseId: string;
    readonly runMode: ScopeLeaseRunMode;
    readonly expectedEpoch: number;
    readonly actualEpoch: number;
}): ScopeLeaseFencingResult;

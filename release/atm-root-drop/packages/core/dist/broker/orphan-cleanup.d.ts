import type { ActiveWriteIntent, WriteBrokerRegistryDocument } from './types.ts';
export type LeaseLifecyclePhase = 'active' | 'suspect' | 'stale';
export declare const DEFAULT_ORPHAN_SCAN_INTERVAL_MS = 60000;
export declare const DEFAULT_MISSED_RENEWAL_THRESHOLD = 2;
export declare const DEFAULT_STALE_LEASE_MULTIPLIER = 2;
export interface OrphanCleanupSuspectRecord {
    readonly intentId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly markedAt: string;
    readonly reason: string;
}
export interface OrphanCleanupState {
    readonly schemaId: 'atm.orphanCleanupState.v1';
    readonly specVersion: '0.1.0';
    readonly suspects: Readonly<Record<string, OrphanCleanupSuspectRecord>>;
}
export interface OrphanCleanupCandidate {
    readonly intentId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly phase: LeaseLifecyclePhase;
    readonly reason: string;
}
export interface OrphanCleanupScanResult {
    readonly newlySuspect: readonly OrphanCleanupCandidate[];
    readonly promotedToStale: readonly OrphanCleanupCandidate[];
    readonly released: readonly OrphanCleanupCandidate[];
    readonly active: readonly OrphanCleanupCandidate[];
    readonly nextState: OrphanCleanupState;
    readonly registry: WriteBrokerRegistryDocument;
}
export interface OrphanCleanupScanOptions {
    readonly now?: number;
    readonly missedRenewalThreshold?: number;
    readonly staleLeaseMultiplier?: number;
}
export declare function emptyOrphanCleanupState(): OrphanCleanupState;
export declare function classifyLeasePhase(intent: ActiveWriteIntent, now: number, options?: OrphanCleanupScanOptions): LeaseLifecyclePhase;
export declare function scanOrphanLeases(registry: WriteBrokerRegistryDocument, state: OrphanCleanupState, options?: OrphanCleanupScanOptions): OrphanCleanupScanResult;
export declare function applyOrphanCleanupScan(registry: WriteBrokerRegistryDocument, state: OrphanCleanupState, options?: OrphanCleanupScanOptions): {
    readonly result: OrphanCleanupScanResult;
    readonly state: OrphanCleanupState;
};

import { type OrphanCleanupState } from './orphan-cleanup.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument } from './types.ts';
export declare const DEFAULT_BROKER_SNAPSHOT_RELATIVE_DIR = ".atm/runtime/broker-snapshot";
export type ManualOverrideKind = 'force-release' | 'force-claim' | 'lease-bypass';
export type ManualOverrideSeverity = 'medium' | 'high' | 'critical';
export interface ManualOverrideAuditEntry {
    readonly auditId: string;
    readonly recordedAt: string;
    readonly actorId: string;
    readonly taskId: string;
    readonly overrideKind: ManualOverrideKind;
    readonly reason: string;
    readonly previousLeaseEpoch: number | null;
    readonly severity: ManualOverrideSeverity;
    readonly activeLeaseCollision: boolean;
}
export interface BrokerRecoverySnapshot {
    readonly schemaId: 'atm.brokerRecoverySnapshot.v1';
    readonly specVersion: '0.1.0';
    readonly flushedAt: string;
    readonly registry: WriteBrokerRegistryDocument;
    readonly orphanCleanupState: OrphanCleanupState;
    readonly manualOverrideAudit: readonly ManualOverrideAuditEntry[];
}
export type RecoveredLeaseStatus = 'requires-renewal' | 'revalidated' | 'rejected-stale';
export interface RecoveredLeaseIntent {
    readonly intent: ActiveWriteIntent;
    readonly recoveryStatus: RecoveredLeaseStatus;
    readonly reason: string;
}
export interface RecoveryLoadResult {
    readonly snapshotPath: string | null;
    readonly recoveredRegistry: WriteBrokerRegistryDocument;
    readonly suspectIntents: readonly RecoveredLeaseIntent[];
    readonly rejectedIntents: readonly RecoveredLeaseIntent[];
    readonly auditTrail: readonly ManualOverrideAuditEntry[];
    readonly orphanCleanupState: OrphanCleanupState;
}
export interface LeaseRevalidationInput {
    readonly intent: ActiveWriteIntent;
    readonly renewalEpoch: number;
    readonly actorId: string;
    readonly now?: number;
}
export interface LeaseRevalidationResult {
    readonly ok: boolean;
    readonly intent: ActiveWriteIntent | null;
    readonly reason: string;
}
export declare function createManualOverrideAuditEntry(input: {
    readonly actorId: string;
    readonly taskId: string;
    readonly overrideKind: ManualOverrideKind;
    readonly reason: string;
    readonly previousLeaseEpoch: number | null;
    readonly activeLeaseCollision: boolean;
    readonly recordedAt?: string;
}): ManualOverrideAuditEntry;
export declare function appendManualOverrideAudit(auditTrail: readonly ManualOverrideAuditEntry[], entry: ManualOverrideAuditEntry): ManualOverrideAuditEntry[];
export declare function buildBrokerRecoverySnapshot(input: {
    readonly registry: WriteBrokerRegistryDocument;
    readonly orphanCleanupState?: OrphanCleanupState;
    readonly manualOverrideAudit?: readonly ManualOverrideAuditEntry[];
    readonly flushedAt?: string;
}): BrokerRecoverySnapshot;
export declare function flushBrokerRecoverySnapshot(input: {
    readonly cwd: string;
    readonly registry: WriteBrokerRegistryDocument;
    readonly orphanCleanupState?: OrphanCleanupState;
    readonly manualOverrideAudit?: readonly ManualOverrideAuditEntry[];
    readonly snapshotDir?: string;
}): {
    readonly snapshotPath: string;
    readonly snapshot: BrokerRecoverySnapshot;
};
export declare function loadLatestBrokerRecoverySnapshot(cwd: string, snapshotDir?: string): BrokerRecoverySnapshot | null;
export declare function recoverRegistryFromSnapshot(snapshot: BrokerRecoverySnapshot, options?: {
    readonly now?: number;
}): RecoveryLoadResult;
export declare function revalidateRecoveredLease(input: LeaseRevalidationInput): LeaseRevalidationResult;
export declare function recoverBrokerRuntime(input: {
    readonly cwd: string;
    readonly snapshotDir?: string;
    readonly now?: number;
}): RecoveryLoadResult;

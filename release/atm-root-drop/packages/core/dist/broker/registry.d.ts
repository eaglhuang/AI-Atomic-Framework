import type { ActiveWriteIntent, BrokerDecision, WriteBrokerRegistryDocument, WriteIntent } from './types.ts';
export declare const DEFAULT_BROKER_CLEANUP_COMMAND = "node atm.mjs broker cleanup --json";
export type StaleRegistryEntryClassification = 'expired-lease' | 'stale-heartbeat' | 'suspect-heartbeat' | 'active-lease';
export interface StaleRegistryEntryEvidence {
    readonly intentId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly owner: string;
    readonly registryPath: string | null;
    readonly expiresAt: string | null;
    readonly heartbeatAt: string | null;
    readonly ageMs: number;
    readonly ageLabel: string;
    readonly classification: StaleRegistryEntryClassification;
    readonly reason: string;
    readonly terminalResidue: boolean;
}
export interface CleanupStaleResult {
    readonly registry: WriteBrokerRegistryDocument;
    readonly removed: readonly StaleRegistryEntryEvidence[];
    readonly removedCount: number;
    readonly cleanupCommand: string;
    readonly guidance: string;
}
export interface CleanupStaleOptions {
    readonly now?: number;
    readonly registryPath?: string | null;
}
export interface LoadRegistryOptions {
    /** When false, stale entries are reported but not persisted during load. Default: true. */
    readonly persistCleanup?: boolean;
}
export interface BlockingRegistryFindingEvidence {
    readonly registryPath: string;
    readonly blocking: StaleRegistryEntryEvidence;
    readonly detail: string;
    readonly cleanupCommand: string;
    readonly guidance: string;
    readonly isStale: boolean;
}
export interface VirtualAtomInUseRecord {
    readonly virtualAtomId: string;
    readonly virtualAtomCid: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly intentId: string;
    readonly lane: ActiveWriteIntent['lane'];
    readonly leaseEpoch: number;
    readonly expiresAt: string | null;
    readonly sourceAtomIds: readonly string[];
}
export interface VirtualAtomInUseRegistryDocument {
    readonly schemaId: 'atm.virtualAtomInUseRegistry.v1';
    readonly specVersion: '0.1.0';
    readonly repoId: string;
    readonly workspaceId: string;
    readonly activeVirtualAtoms: readonly VirtualAtomInUseRecord[];
    readonly activeIntents: readonly ActiveWriteIntent[];
}
export declare function loadRegistry(filePath: string, options?: LoadRegistryOptions): WriteBrokerRegistryDocument;
export declare function saveRegistry(filePath: string, doc: WriteBrokerRegistryDocument): void;
export declare function registerIntent(doc: WriteBrokerRegistryDocument, intent: WriteIntent, lane: 'direct-brokered' | 'deterministic-composer' | 'neutral-steward' | 'serial' | 'blocked', ttlSeconds?: number, admissionOverride?: ActiveWriteIntent['admission']): WriteBrokerRegistryDocument;
export declare function renewIntentLease(doc: WriteBrokerRegistryDocument, taskId: string, actorId: string, ttlSeconds?: number): WriteBrokerRegistryDocument;
export declare function releaseTask(doc: WriteBrokerRegistryDocument, taskId: string): WriteBrokerRegistryDocument;
export declare function cleanupStale(doc: WriteBrokerRegistryDocument, options?: CleanupStaleOptions): WriteBrokerRegistryDocument;
export declare function cleanupStaleWithEvidence(doc: WriteBrokerRegistryDocument, options?: CleanupStaleOptions): CleanupStaleResult;
export declare function buildBrokerCleanupCommand(registryPath?: string): string;
export declare function formatIntentAgeLabel(ageMs: number): string;
export declare function computeIntentAgeMs(intent: ActiveWriteIntent, now?: number): number;
export declare function classifyStaleRegistryEntry(intent: ActiveWriteIntent, now?: number): StaleRegistryEntryClassification;
export declare function describeStaleRegistryEntry(intent: ActiveWriteIntent, options?: {
    readonly now?: number;
    readonly registryPath?: string | null;
}): StaleRegistryEntryEvidence;
export declare function describeBlockingRegistryIntent(intent: ActiveWriteIntent, options: {
    readonly registryPath: string;
    readonly now?: number;
}): StaleRegistryEntryEvidence & {
    readonly isStale: boolean;
};
export declare function resolveConflictBlockingIntent(decision: BrokerDecision, registry: WriteBrokerRegistryDocument): ActiveWriteIntent | null;
export declare function formatRegistryResidueGuidance(input: {
    readonly registryPath: string;
    readonly removed?: readonly StaleRegistryEntryEvidence[];
    readonly blocking?: StaleRegistryEntryEvidence | null;
}): string;
export declare function buildBlockingRegistryFindingEvidence(input: {
    readonly registryPath: string;
    readonly blockingIntent: ActiveWriteIntent;
    readonly baseReason: string;
    readonly now?: number;
}): BlockingRegistryFindingEvidence;
export declare function buildVirtualAtomInUseRegistry(doc: WriteBrokerRegistryDocument): VirtualAtomInUseRegistryDocument;

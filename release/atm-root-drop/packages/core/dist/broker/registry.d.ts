import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from './types.ts';
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
export declare function loadRegistry(filePath: string): WriteBrokerRegistryDocument;
export declare function saveRegistry(filePath: string, doc: WriteBrokerRegistryDocument): void;
export declare function registerIntent(doc: WriteBrokerRegistryDocument, intent: WriteIntent, lane: 'direct-brokered' | 'deterministic-composer' | 'neutral-steward' | 'serial' | 'blocked', ttlSeconds?: number): WriteBrokerRegistryDocument;
export declare function renewIntentLease(doc: WriteBrokerRegistryDocument, taskId: string, actorId: string, ttlSeconds?: number): WriteBrokerRegistryDocument;
export declare function releaseTask(doc: WriteBrokerRegistryDocument, taskId: string): WriteBrokerRegistryDocument;
export declare function cleanupStale(doc: WriteBrokerRegistryDocument): WriteBrokerRegistryDocument;
export declare function buildVirtualAtomInUseRegistry(doc: WriteBrokerRegistryDocument): VirtualAtomInUseRegistryDocument;

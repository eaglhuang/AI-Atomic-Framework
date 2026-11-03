import type { WriteBrokerRegistryDocument } from './types.js';
export type BrokerRegistryRecoveryKind = 'missing' | 'invalid-json' | 'invalid-shape' | 'checksum-mismatch' | 'stale-generation';
export interface BrokerRegistryRecoveryFact {
    readonly schemaId: 'atm.brokerRegistryRecoveryFact.v1';
    readonly kind: BrokerRegistryRecoveryKind;
    readonly registryPath: string;
    readonly message: string;
    readonly failClosed: true;
    readonly observedDigest?: string;
    readonly expectedDigest?: string;
    readonly generation?: number | null;
}
export interface BrokerRegistrySnapshot {
    readonly schemaId: 'atm.brokerRegistrySnapshot.v1';
    readonly registryPath: string;
    readonly generation: number;
    readonly digest: string;
    readonly lastTransactionId: string | null;
    readonly document: WriteBrokerRegistryDocument;
}
export interface BrokerRegistryWriteReceipt {
    readonly schemaId: 'atm.brokerRegistryWriteReceipt.v1';
    readonly transactionId: string;
    readonly registryPath: string;
    readonly baseGeneration: number;
    readonly nextGeneration: number;
    readonly baseDigest: string;
    readonly nextDigest: string;
    readonly committedAt: string;
}
export interface BrokerRegistryStore {
    readonly registryPath: string;
    read(): BrokerRegistrySnapshot;
    write(input: {
        readonly base: BrokerRegistrySnapshot;
        readonly next: WriteBrokerRegistryDocument;
        readonly transactionId: string;
        readonly now?: string;
    }): BrokerRegistryWriteReceipt;
}
export declare class BrokerRegistryStoreError extends Error {
    readonly code: string;
    readonly recoveryFact: BrokerRegistryRecoveryFact;
    constructor(code: string, recoveryFact: BrokerRegistryRecoveryFact);
}
export declare function createEmptyBrokerRegistryDocument(input?: {
    readonly currentEpoch?: number;
    readonly repoId?: string;
    readonly workspaceId?: string;
}): WriteBrokerRegistryDocument;
export declare function createBrokerRegistryStore(registryPath: string): BrokerRegistryStore;
export declare function readBrokerRegistrySnapshot(registryPath: string): BrokerRegistrySnapshot;
export declare function writeBrokerRegistrySnapshot(registryPath: string, input: {
    readonly base: BrokerRegistrySnapshot;
    readonly next: WriteBrokerRegistryDocument;
    readonly transactionId: string;
    readonly now?: string;
}): BrokerRegistryWriteReceipt;
export declare function digestRegistryDocument(document: WriteBrokerRegistryDocument): string;

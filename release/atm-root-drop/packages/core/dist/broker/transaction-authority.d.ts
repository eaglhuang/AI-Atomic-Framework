import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from './types.js';
import type { BrokerAdmissionResult } from './admission/contracts.js';
import { type BrokerRegistrySnapshot, type BrokerRegistryStore } from './registry-store.js';
export type BrokerTransactionOperation = 'register' | 'heartbeat' | 'release' | 'adopt';
export interface BrokerTransactionReceipt {
    readonly admission?: BrokerAdmissionResult;
    readonly schemaId: 'atm.brokerTransactionReceipt.v1';
    readonly specVersion: '0.1.0';
    readonly transactionId: string;
    readonly operation: BrokerTransactionOperation;
    readonly taskId: string;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly status: 'committed' | 'idempotent-replay';
    readonly registryPath: string;
    readonly baseGeneration: number;
    readonly nextGeneration: number;
    readonly baseDigest: string;
    readonly nextDigest: string;
    readonly committedAt: string;
}
export interface BrokerTransactionAuthority {
    readonly store: BrokerRegistryStore;
    read(): BrokerRegistrySnapshot;
    register(input: {
        readonly intent: WriteIntent;
        readonly lane: ActiveWriteIntent['lane'];
        readonly ttlSeconds?: number;
        readonly admissionOverride?: ActiveWriteIntent['admission'];
        readonly resolveRegistration?: (doc: WriteBrokerRegistryDocument) => {
            readonly lane: ActiveWriteIntent['lane'];
            readonly admissionOverride?: ActiveWriteIntent['admission'];
        };
        readonly idempotencyKey?: string;
        readonly queueTicketId?: string;
        readonly currentBaseCommit?: string | null;
        readonly resolveCurrentBaseCommit?: () => string | null;
    }): BrokerTransactionReceipt;
    heartbeat(input: {
        readonly taskId: string;
        readonly actorId: string;
        readonly ttlSeconds?: number;
        readonly idempotencyKey?: string;
    }): BrokerTransactionReceipt;
    release(input: {
        readonly taskId: string;
        readonly actorId: string;
        readonly idempotencyKey?: string;
    }): BrokerTransactionReceipt;
}
export declare class BrokerTransactionAuthorityError extends Error {
    readonly code: string;
    readonly details: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare function createBrokerTransactionAuthority(registryPath: string): BrokerTransactionAuthority;
export declare function assertSameTaskLaneFence(input: {
    readonly doc: WriteBrokerRegistryDocument;
    readonly taskId: string;
    readonly actorId: string;
    readonly operation: BrokerTransactionOperation;
}): void;
type BrokerTransactionInput = {
    readonly store: BrokerRegistryStore;
    readonly operation: BrokerTransactionOperation;
    readonly taskId: string;
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly mutate: (doc: WriteBrokerRegistryDocument) => WriteBrokerRegistryDocument;
    readonly canReplay?: (doc: WriteBrokerRegistryDocument) => boolean;
    readonly onReplay?: (doc: WriteBrokerRegistryDocument) => void;
};
export declare function commitBrokerRegistryTransaction(input: BrokerTransactionInput): BrokerTransactionReceipt;
export declare function buildBrokerTransactionId(operation: BrokerTransactionOperation, taskId: string, actorId: string, idempotencyKey: string): string;
export {};

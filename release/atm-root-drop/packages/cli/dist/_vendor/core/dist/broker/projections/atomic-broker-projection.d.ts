import type { BrokerTicketStoreDocument } from '../ticket-store.js';
export type BrokerProjectionTerminalState = 'open' | 'terminal' | 'queue-only';
export type BrokerProjectionWriteStatus = 'committed' | 'idempotent-replay' | 'stale-generation' | 'retry-exhausted';
export type BrokerProjectionAuthority = Readonly<{
    schemaId: 'atm.brokerProjectionAuthority.v1';
    ticketId: string;
    generation: number;
    watermark: string;
    terminalState: BrokerProjectionTerminalState;
    state: unknown;
}>;
export type AtmBrokerProjectionV1 = Readonly<{
    schemaId: 'atm.brokerProjection.v1';
    specVersion: '0.1.0';
    ticketId: string;
    authorityGeneration: number;
    authorityDigest: string;
    projectionDigest: string;
    watermark: string;
    terminalState: BrokerProjectionTerminalState;
    publisherGeneration: number;
    generatedAt: string;
    state: unknown;
}>;
export type BrokerProjectionWriteReceipt = Readonly<{
    schemaId: 'atm.brokerProjectionWriteReceipt.v1';
    status: BrokerProjectionWriteStatus;
    projectionPath: string;
    errorCode: 'ATM_BROKER_TICKET_STALE_GENERATION' | 'ATM_ATOMIC_WRITE_RETRY_EXHAUSTED' | null;
    previousPublisherGeneration: number | null;
    nextPublisherGeneration: number | null;
    projectionDigest: string | null;
    attempts: number;
}>;
export type BrokerQueueOnlyTrip = Readonly<{
    schemaId: 'atm.brokerQueueOnlyTrip.v1';
    ticketId: string;
    errorCode: 'ATM_BROKER_STATE_DIVERGENCE';
    reason: string;
    preserved: {
        readonly ticket: unknown;
        readonly proposal: unknown;
        readonly evidence: unknown;
    };
}>;
export declare function buildBrokerProjection(authority: BrokerProjectionAuthority, input?: {
    readonly publisherGeneration?: number;
    readonly generatedAt?: string;
}): AtmBrokerProjectionV1;
export declare function authorityFromTicketStore(document: BrokerTicketStoreDocument, ticketId: string): BrokerProjectionAuthority;
export declare function digestBrokerProjectionAuthority(authority: BrokerProjectionAuthority): string;
export declare function isBrokerProjectionFresh(projection: AtmBrokerProjectionV1, authority: BrokerProjectionAuthority): boolean;
export declare function readBrokerProjection(projectionPath: string): AtmBrokerProjectionV1 | null;
export declare function atomicWriteBrokerProjection(input: {
    readonly projectionPath: string;
    readonly projection: AtmBrokerProjectionV1;
    readonly expectedPublisherGeneration?: number | null;
    readonly maxRetries?: number;
    readonly simulateSharingViolations?: number;
}): BrokerProjectionWriteReceipt;
export declare function recordBrokerQueueOnlyTrip(input: {
    readonly ticketId: string;
    readonly reason: string;
    readonly ticket: unknown;
    readonly proposal: unknown;
    readonly evidence: unknown;
}): BrokerQueueOnlyTrip;

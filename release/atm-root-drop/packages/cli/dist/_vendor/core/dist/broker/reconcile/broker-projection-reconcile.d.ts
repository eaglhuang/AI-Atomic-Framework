import { type AtmBrokerProjectionV1, type BrokerProjectionAuthority, type BrokerProjectionWriteReceipt, type BrokerQueueOnlyTrip } from '../projections/atomic-broker-projection.js';
export type BrokerProjectionReconcileStatus = 'fresh' | 'rebuilt' | 'quarantined' | 'queue-only';
export type BrokerProjectionReconcileResult = Readonly<{
    schemaId: 'atm.brokerProjectionReconcileResult.v1';
    status: BrokerProjectionReconcileStatus;
    ticketId: string;
    staleProjectionAuthorizes: false;
    projection: AtmBrokerProjectionV1;
    previousProjectionDigest: string | null;
    writeReceipt: BrokerProjectionWriteReceipt | null;
    queueOnlyTrip: BrokerQueueOnlyTrip | null;
    diagnostics: readonly {
        readonly code: 'ATM_BROKER_STATE_DIVERGENCE' | 'ATM_BROKER_TICKET_STALE_GENERATION' | 'ATM_ATOMIC_WRITE_RETRY_EXHAUSTED';
        readonly message: string;
    }[];
}>;
export declare function reconcileBrokerProjection(input: {
    readonly projectionPath: string;
    readonly authority: BrokerProjectionAuthority;
    readonly expectedPublisherGeneration?: number | null;
    readonly now?: string;
    readonly quarantineDivergence?: boolean;
    readonly preserve?: {
        readonly ticket: unknown;
        readonly proposal: unknown;
        readonly evidence: unknown;
    };
}): BrokerProjectionReconcileResult;

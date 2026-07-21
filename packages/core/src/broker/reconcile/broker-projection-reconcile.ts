import {
  atomicWriteBrokerProjection,
  buildBrokerProjection,
  isBrokerProjectionFresh,
  readBrokerProjection,
  recordBrokerQueueOnlyTrip,
  type AtmBrokerProjectionV1,
  type BrokerProjectionAuthority,
  type BrokerProjectionWriteReceipt,
  type BrokerQueueOnlyTrip
} from '../projections/atomic-broker-projection.ts';

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

export function reconcileBrokerProjection(input: {
  readonly projectionPath: string;
  readonly authority: BrokerProjectionAuthority;
  readonly expectedPublisherGeneration?: number | null;
  readonly now?: string;
  readonly quarantineDivergence?: boolean;
  readonly preserve?: { readonly ticket: unknown; readonly proposal: unknown; readonly evidence: unknown };
}): BrokerProjectionReconcileResult {
  const previous = readBrokerProjection(input.projectionPath);
  if (previous && isBrokerProjectionFresh(previous, input.authority)) {
    return {
      schemaId: 'atm.brokerProjectionReconcileResult.v1',
      status: 'fresh',
      ticketId: input.authority.ticketId,
      staleProjectionAuthorizes: false,
      projection: previous,
      previousProjectionDigest: previous.projectionDigest,
      writeReceipt: null,
      queueOnlyTrip: null,
      diagnostics: []
    };
  }

  const rebuilt = buildBrokerProjection(input.authority, { generatedAt: input.now, publisherGeneration: input.authority.generation });
  if (previous && input.quarantineDivergence) {
    const queueOnlyTrip = recordBrokerQueueOnlyTrip({
      ticketId: input.authority.ticketId,
      reason: 'projection diverged from canonical broker authority; direct publisher authority is suspended',
      ticket: input.preserve?.ticket ?? input.authority.state,
      proposal: input.preserve?.proposal ?? null,
      evidence: input.preserve?.evidence ?? { previousProjectionDigest: previous.projectionDigest }
    });
    return {
      schemaId: 'atm.brokerProjectionReconcileResult.v1',
      status: 'queue-only',
      ticketId: input.authority.ticketId,
      staleProjectionAuthorizes: false,
      projection: rebuilt,
      previousProjectionDigest: previous.projectionDigest,
      writeReceipt: null,
      queueOnlyTrip,
      diagnostics: [{ code: 'ATM_BROKER_STATE_DIVERGENCE', message: queueOnlyTrip.reason }]
    };
  }

  const writeReceipt = atomicWriteBrokerProjection({
    projectionPath: input.projectionPath,
    projection: rebuilt,
    expectedPublisherGeneration: input.expectedPublisherGeneration ?? previous?.publisherGeneration ?? null
  });
  const status = writeReceipt.status === 'committed' || writeReceipt.status === 'idempotent-replay' ? 'rebuilt' : 'quarantined';
  return {
    schemaId: 'atm.brokerProjectionReconcileResult.v1',
    status,
    ticketId: input.authority.ticketId,
    staleProjectionAuthorizes: false,
    projection: rebuilt,
    previousProjectionDigest: previous?.projectionDigest ?? null,
    writeReceipt,
    queueOnlyTrip: null,
    diagnostics: writeReceipt.errorCode
      ? [{ code: writeReceipt.errorCode, message: `projection write ${writeReceipt.status}` }]
      : []
  };
}

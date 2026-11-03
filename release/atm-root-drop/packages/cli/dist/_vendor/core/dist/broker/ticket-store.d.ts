import { type BrokerTicket, type BrokerTicketState } from './ticket-state.js';
export type BrokerTicketStoreAction = 'enqueue' | 'transition' | 'wake-next' | 'adopt-orphan' | 'cancel' | 'reconcile-side-effect';
export type BrokerTicketStoreDocument = Readonly<{
    schemaId: 'atm.brokerTicketStore.v1';
    specVersion: '0.1.0';
    storeId: string;
    generation: number;
    tickets: readonly BrokerTicket[];
    transitions: readonly BrokerTicketStoreTransitionEvidence[];
    updatedAt: string;
}>;
export type BrokerTicketStoreSnapshot = Readonly<{
    schemaId: 'atm.brokerTicketStoreSnapshot.v1';
    storePath: string;
    generation: number;
    digest: string;
    document: BrokerTicketStoreDocument;
}>;
export type BrokerTicketStoreTransitionEvidence = Readonly<{
    schemaId: 'atm.brokerTicketStoreTransitionEvidence.v1';
    transitionId: string;
    idempotencyKey: string;
    taskId: string;
    actorId: string;
    laneId: string | null;
    ticketId: string | null;
    action: BrokerTicketStoreAction;
    previousDigest: string;
    nextDigest: string;
    previousGeneration: number;
    nextGeneration: number;
    occurredAt: string;
}>;
export type BrokerTicketStoreReceipt = Readonly<{
    schemaId: 'atm.brokerTicketStoreReceipt.v1';
    status: 'committed' | 'idempotent-replay' | 'revalidation-required';
    action: BrokerTicketStoreAction;
    taskId: string;
    actorId: string;
    laneId: string | null;
    idempotencyKey: string;
    storePath: string;
    baseDigest: string;
    nextDigest: string;
    baseGeneration: number;
    nextGeneration: number;
    transitionEvidence: BrokerTicketStoreTransitionEvidence | null;
    ticket: BrokerTicket | null;
    revalidationTicket: BrokerTicket | null;
    recoveryCommand: string | null;
}>;
export interface BrokerTicketStore {
    readonly storePath: string;
    read(): BrokerTicketStoreSnapshot;
    commit(input: BrokerTicketStoreCommitInput): BrokerTicketStoreReceipt;
}
export type BrokerTicketStoreCommitInput = Readonly<{
    base: BrokerTicketStoreSnapshot;
    action: BrokerTicketStoreAction;
    taskId: string;
    actorId: string;
    laneId?: string | null;
    idempotencyKey: string;
    now?: string;
    mutate: (document: BrokerTicketStoreDocument, context: BrokerTicketStoreMutationContext) => BrokerTicketStoreMutationResult;
}>;
export type BrokerTicketStoreMutationContext = Readonly<{
    now: string;
}>;
export type BrokerTicketStoreMutationResult = Readonly<{
    document: BrokerTicketStoreDocument;
    ticket?: BrokerTicket | null;
}>;
export type EnqueueBrokerTicketInput = Readonly<{
    taskId: string;
    actorId: string;
    resourceKey: string;
    laneId?: string | null;
    idempotencyKey?: string;
    now?: string;
    ttlSeconds?: number;
}>;
export type TransitionStoredBrokerTicketInput = Readonly<{
    ticketId: string;
    to: BrokerTicketState;
    taskId: string;
    actorId: string;
    laneId?: string | null;
    reason: string;
    idempotencyKey: string;
    now?: string;
}>;
export type WakeNextBrokerTicketInput = Readonly<{
    resourceKey: string;
    taskId: string;
    actorId: string;
    laneId?: string | null;
    idempotencyKey: string;
    maxBypassCount?: number;
    maxEligibleWaitMs?: number;
    now?: string;
}>;
export type AdoptOrphanBrokerTicketInput = Readonly<{
    ticketId: string;
    taskId: string;
    actorId: string;
    laneId?: string | null;
    reason: string;
    idempotencyKey: string;
    now?: string;
}>;
export type ReconcileBrokerTicketInput = AdoptOrphanBrokerTicketInput;
export declare function createEmptyBrokerTicketStoreDocument(input?: {
    readonly storeId?: string;
    readonly now?: string;
}): BrokerTicketStoreDocument;
export declare function createBrokerTicketStore(storePath: string): BrokerTicketStore;
export declare function readBrokerTicketStoreSnapshot(storePath: string): BrokerTicketStoreSnapshot;
export declare function digestBrokerTicketStoreDocument(document: BrokerTicketStoreDocument): string;
export declare function enqueueBrokerTicket(store: BrokerTicketStore, input: EnqueueBrokerTicketInput): BrokerTicketStoreReceipt;
export declare function transitionStoredBrokerTicket(store: BrokerTicketStore, input: TransitionStoredBrokerTicketInput): BrokerTicketStoreReceipt;
export declare function wakeNextBrokerTicket(store: BrokerTicketStore, input: WakeNextBrokerTicketInput): BrokerTicketStoreReceipt;
export declare function adoptOrphanBrokerTicket(store: BrokerTicketStore, input: AdoptOrphanBrokerTicketInput): BrokerTicketStoreReceipt;
export declare function cancelBrokerTicket(store: BrokerTicketStore, input: ReconcileBrokerTicketInput): BrokerTicketStoreReceipt;
export declare function reconcileBrokerTicketSideEffect(store: BrokerTicketStore, input: ReconcileBrokerTicketInput): BrokerTicketStoreReceipt;
export declare function isBrokerTicketOrphan(ticket: BrokerTicket, now?: string): boolean;
export declare function commitBrokerTicketStoreTransaction(storePath: string, input: BrokerTicketStoreCommitInput): BrokerTicketStoreReceipt;

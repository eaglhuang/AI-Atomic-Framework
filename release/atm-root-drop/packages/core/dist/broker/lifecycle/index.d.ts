import type { BrokerTicket } from '../ticket-state.js';
export type BrokerTicketCompletionSideEffectKind = 'publish' | 'release' | 'wakeup';
export interface BrokerTicketCompletionSideEffect {
    readonly kind: BrokerTicketCompletionSideEffectKind;
    readonly target: string;
    readonly idempotencyKey: string;
}
export interface BrokerTicketCompletionReceipt {
    readonly schemaId: 'atm.brokerTicketCompletionReceipt.v1';
    readonly ticketId: string;
    readonly taskId: string;
    readonly ok: boolean;
    readonly code: null | 'ATM_BROKER_STATE_DIVERGENCE' | 'ATM_TICKET_CANCEL_REQUIRED' | 'ATM_SIDE_EFFECT_RECONCILE_REQUIRED';
    readonly previousStateDigest: string;
    readonly nextStateDigest: string;
    readonly generation: number;
    readonly terminalAuthorizationCount: number;
    readonly duplicateSideEffectCount: number;
    readonly queueOnly: boolean;
    readonly sideEffects: readonly BrokerTicketCompletionSideEffect[];
    readonly findings: readonly string[];
}
export interface TaskflowCloseIndexIsolationReceipt {
    readonly schemaId: 'atm.taskflowCloseIndexIsolationReceipt.v1';
    readonly ok: boolean;
    readonly parkedForeignEntries: readonly string[];
    readonly restoredForeignEntries: readonly string[];
    readonly closeScopedEntries: readonly string[];
    readonly beforeDigest: string;
    readonly afterDigest: string;
    readonly restoreContract: 'immutable-receipt-required';
}
export declare function completeBrokerTicketTransaction(input: {
    readonly ticket: BrokerTicket & {
        readonly authorizationGrants?: readonly unknown[];
        readonly completedSideEffects?: readonly BrokerTicketCompletionSideEffect[];
    };
    readonly actorId: string;
    readonly idempotencyKey: string;
    readonly now?: string;
    readonly successorTaskId?: string | null;
    readonly sideEffects?: readonly Omit<BrokerTicketCompletionSideEffect, 'idempotencyKey'>[];
}): BrokerTicketCompletionReceipt;
export declare function buildTaskflowCloseIndexIsolationReceipt(input: {
    readonly closeScopedEntries: readonly string[];
    readonly foreignStagedEntries: readonly string[];
    readonly restoredForeignEntries?: readonly string[];
}): TaskflowCloseIndexIsolationReceipt;
export declare function digestBrokerLifecycleState(value: unknown): string;

export type BrokerTicketState = 'created' | 'collecting' | 'ready' | 'composing' | 'revalidation-required' | 'queued' | 'wakeup-pending' | 'executing' | 'released' | 'cancelled' | 'adoptable' | 'reconcile-required';
export type BrokerTicketTerminalReason = 'released' | 'cancelled' | 'adopted' | 'reconcile-required' | 'policy-terminal';
export interface BrokerTicketTransition {
    readonly eventId: string;
    readonly idempotencyKey: string;
    readonly from: BrokerTicketState;
    readonly to: BrokerTicketState;
    readonly generation: number;
    readonly actorId: string;
    readonly reason: string;
    readonly occurredAt: string;
}
export interface BrokerTicket {
    readonly schemaId: 'atm.brokerTicket.v1';
    readonly specVersion: '0.1.0';
    readonly ticketId: string;
    readonly idempotencyKey: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly resourceKey: string;
    readonly state: BrokerTicketState;
    readonly generation: number;
    readonly arrivalIndex: number;
    readonly enqueuedAt: string;
    readonly updatedAt: string;
    readonly heartbeatAt: string;
    readonly ttlSeconds: number;
    readonly bypassCount: number;
    readonly wakeupCount: number;
    readonly terminalReason: BrokerTicketTerminalReason | null;
    readonly transitions: readonly BrokerTicketTransition[];
}
export interface BrokerTicketTransitionResult {
    readonly ticket: BrokerTicket;
    readonly transition: BrokerTicketTransition;
    readonly replayed: boolean;
}
export declare function createBrokerTicket(input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly resourceKey: string;
    readonly arrivalIndex?: number;
    readonly now?: string;
    readonly ttlSeconds?: number;
}): BrokerTicket;
export declare function transitionBrokerTicket(input: {
    readonly ticket: BrokerTicket;
    readonly to: BrokerTicketState;
    readonly actorId: string;
    readonly reason: string;
    readonly idempotencyKey: string;
    readonly now?: string;
}): BrokerTicketTransitionResult;
export declare function assertBrokerTicketCanExecute(ticket: BrokerTicket): void;

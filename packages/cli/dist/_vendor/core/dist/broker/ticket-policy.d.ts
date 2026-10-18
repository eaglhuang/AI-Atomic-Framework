import type { BrokerTicket } from './ticket-state.js';
export interface BrokerTicketFairnessPolicy {
    readonly schemaId: 'atm.brokerTicketFairnessPolicy.v1';
    readonly specVersion: '0.1.0';
    readonly maxBypassCount: number;
    readonly maxEligibleWaitMs: number;
    readonly wakeupCycleBound: number;
    readonly composeBatchMinSize: number;
    readonly seed: string;
    readonly observationHorizonMs: number;
}
export interface BrokerTicketSelectionTrace {
    readonly schemaId: 'atm.brokerTicketSelectionTrace.v1';
    readonly selectedTicketIds: readonly string[];
    readonly composeCandidateTicketIds: readonly string[];
    readonly queuedTicketIds: readonly string[];
    readonly bypassedTicketIds: readonly string[];
    readonly waitedMsByTicketId: Record<string, number>;
    readonly fairnessCounters: {
        readonly maxObservedBypassCount: number;
        readonly maxObservedWaitMs: number;
        readonly duplicateWakeupCount: number;
        readonly starvationRiskTicketIds: readonly string[];
    };
    readonly policy: BrokerTicketFairnessPolicy;
    readonly reason: string;
}
export declare const defaultBrokerTicketFairnessPolicy: BrokerTicketFairnessPolicy;
export declare function selectComposeFirstTickets(input: {
    readonly tickets: readonly BrokerTicket[];
    readonly now?: string;
    readonly policy?: BrokerTicketFairnessPolicy;
}): BrokerTicketSelectionTrace;

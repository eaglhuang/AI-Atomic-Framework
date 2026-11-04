import { type BrokerTicket } from '../ticket-state.js';
export type BrokerTicketAuthorizationResourceKind = 'path' | 'atom' | 'surface' | 'range';
export type BrokerTicketOperation = 'read' | 'write' | 'commit' | 'close' | 'execute' | (string & {});
export type BrokerTicketGate = 'git' | 'taskflow' | 'broker' | 'runner-sync' | (string & {});
export interface BrokerTicketAuthorizationGrant {
    readonly grantId: string;
    readonly resourceKind: BrokerTicketAuthorizationResourceKind;
    readonly resourceKeys: readonly string[];
    readonly operations: readonly string[];
    readonly gates: readonly string[];
    readonly authorityGeneration: number;
    readonly authorityDigest: string;
}
export type BrokerTicketWithAuthority = BrokerTicket & {
    readonly authorityGeneration: number;
    readonly authorityDigest: string;
    readonly authorizationGrants: readonly BrokerTicketAuthorizationGrant[];
};
export interface BrokerTicketAuthorizationRequest {
    readonly resourceKind: BrokerTicketAuthorizationResourceKind;
    readonly resourceKey: string;
    readonly operation: BrokerTicketOperation;
    readonly gate: BrokerTicketGate;
    readonly expectedAuthorityGeneration?: number;
    readonly expectedAuthorityDigest?: string;
}
export interface BrokerTicketAuthorizationDecision {
    readonly authorized: boolean;
    readonly statusCode: 'authorized' | 'terminal-ticket' | 'stale-generation' | 'authority-digest-mismatch' | 'resource-dimension-mismatch' | 'resource-key-mismatch' | 'operation-mismatch' | 'gate-mismatch';
    readonly ticketId: string;
    readonly authorityGeneration: number;
    readonly authorityDigest: string;
    readonly grantId: string | null;
}
export declare function attachBrokerTicketAuthorizationGrants(ticket: BrokerTicket, grants: readonly Omit<BrokerTicketAuthorizationGrant, 'grantId' | 'authorityGeneration' | 'authorityDigest'>[]): BrokerTicketWithAuthority;
export declare function authorizeBrokerTicket(ticket: BrokerTicket | BrokerTicketWithAuthority, request: BrokerTicketAuthorizationRequest): BrokerTicketAuthorizationDecision;

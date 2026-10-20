import { type WriteScopePolicyDecision, type WriteScopeOperation } from './write-scope-policy.js';
export interface WriteTicket {
    readonly schemaId: 'atm.writeTicket.v1';
    readonly ticketId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly laneSessionId: string | null;
    readonly allowedFiles: readonly string[];
    readonly intent: string;
    readonly operationClass: string;
    readonly scopeDigest: string;
    readonly issuedAt: string;
    readonly expiresAt: string;
    readonly recoveryPolicy: 'scope-amendment-first';
}
export interface WriteTicketAcquireInput {
    readonly taskId: string;
    readonly actorId: string;
    readonly files: readonly string[];
    readonly intent?: string | null;
    readonly laneSessionId?: string | null;
    readonly ttlSeconds?: number | null;
    readonly now?: string | null;
}
export declare function acquireWriteTicket(input: WriteTicketAcquireInput): WriteTicket;
export declare function checkWriteTicket(input: {
    readonly ticket: WriteTicket | null;
    readonly taskId: string;
    readonly actorId: string;
    readonly files: readonly string[];
    readonly operation?: WriteScopeOperation;
    readonly observedPhase?: 'pre-write' | 'post-write' | 'commit' | 'close' | 'push';
    readonly claimActorId?: string | null;
    readonly laneSessionId?: string | null;
    readonly ambientActorId?: string | null;
    readonly recoveryBypassed?: boolean;
    readonly now?: string | null;
}): WriteScopePolicyDecision;
export type { WriteScopePolicyDecision };

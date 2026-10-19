export type WriteScopeDecisionCode = 'ATM_WRITE_SCOPE_AMENDMENT_REQUIRED' | 'ATM_WRITE_SCOPE_UNATTACHED_WIP' | 'ATM_WRITE_TICKET_SCOPE_VIOLATION' | 'ATM_WRITE_TICKET_MISSING' | 'ATM_WRITE_TICKET_STALE';
export type WriteScopeOperation = 'write' | 'stage' | 'commit' | 'close' | 'push';
export interface WriteScopePolicyInput {
    readonly taskId: string;
    readonly actorId: string;
    readonly requestedFiles: readonly string[];
    readonly allowedFiles: readonly string[];
    readonly operation?: WriteScopeOperation;
    readonly observedPhase?: 'pre-write' | 'post-write' | 'commit' | 'close' | 'push';
    readonly ticketActorId?: string | null;
    readonly ticketTaskId?: string | null;
    readonly claimActorId?: string | null;
    readonly laneSessionId?: string | null;
    readonly ticketLaneSessionId?: string | null;
    readonly ambientActorId?: string | null;
    readonly ticketExpiresAt?: string | null;
    readonly now?: string | null;
    readonly recoveryBypassed?: boolean;
}
export interface WriteScopePolicyDecision {
    readonly ok: boolean;
    readonly code: WriteScopeDecisionCode | null;
    readonly classification: 'allowed' | 'amendment-required' | 'unattached-wip' | 'violation' | 'missing-ticket' | 'stale-ticket';
    readonly taskId: string;
    readonly actorId: string;
    readonly requestedFiles: readonly string[];
    readonly allowedFiles: readonly string[];
    readonly outOfScopeFiles: readonly string[];
    readonly protectedHistoryFiles: readonly string[];
    readonly scopeDigest: string;
    readonly identity: {
        readonly claimActorId: string | null;
        readonly ticketActorId: string | null;
        readonly ambientActorId: string | null;
        readonly actorMismatch: boolean;
        readonly laneMismatch: boolean;
    };
    readonly recoveryCommand: string | null;
    readonly recoveryCommands: Readonly<Record<string, string>>;
    readonly reason: string;
}
export declare function normalizeWritePath(value: string): string;
export declare function normalizeWritePathList(values: readonly string[]): readonly string[];
export declare function computeWriteScopeDigest(allowedFiles: readonly string[]): string;
export declare function pathMatchesWriteScope(file: string, scope: string): boolean;
export declare function isProtectedHistoryPath(file: string): boolean;
export declare function inspectWriteScopePolicy(input: WriteScopePolicyInput): WriteScopePolicyDecision;

export declare const claimEventLogRelativePath: string;
export type ClaimEventType = 'claim' | 'claim-overlap' | 'overlap-notice-delivered' | 'renew' | 'expire' | 'release' | 'unclaimed-write' | 'steward-accept' | 'steward-reject';
export interface ClaimEvent {
    readonly schemaId: 'atm.claimEvent.v1';
    readonly seq: number;
    readonly at: string;
    readonly monoNs: string;
    readonly type: ClaimEventType;
    readonly actorId: string;
    readonly claimId: string | null;
    readonly files: readonly string[];
    readonly relatedClaimIds: readonly string[];
    readonly detail: Record<string, unknown>;
}
export interface ClaimEventInput {
    readonly type: ClaimEventType;
    readonly actorId: string;
    readonly claimId?: string | null;
    readonly files?: readonly string[];
    readonly relatedClaimIds?: readonly string[];
    readonly detail?: Record<string, unknown>;
}
export declare function claimEventLogPath(cwd: string): string;
/** Appends one event. Callers must hold the claim-share lock so `seq` stays strictly increasing. */
export declare function appendClaimEvent(cwd: string, seq: number, nowMs: number, input: ClaimEventInput): ClaimEvent;
export declare function readClaimEvents(cwd: string): ClaimEvent[];

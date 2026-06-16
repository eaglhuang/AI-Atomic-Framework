export declare const DEFAULT_FREEZE_ACK_TIMEOUT_MS = 30000;
export declare const DEFAULT_WIP_SNAPSHOT_RELATIVE_DIR = ".atm/runtime/wip-snapshot";
export type FreezeState = 'pending' | 'acknowledged' | 'timed-out' | 'force-released' | 'resumed' | 'blocked-fallback';
export interface FreezeSignal {
    readonly taskId: string;
    readonly actorId: string;
    readonly issuedAt: string;
    readonly ackTimeoutMs: number;
    readonly freezeId: string;
    readonly blockingTask?: string;
    readonly blockingRoute?: string;
    readonly conflictingResource?: string;
}
export interface FreezeAck {
    readonly freezeId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly acknowledgedAt: string;
}
export interface FreezeDecision {
    readonly freezeId: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly state: FreezeState;
    readonly deadlineAt: string;
    readonly reason: string;
}
export interface FreezeResolution {
    readonly decision: FreezeDecision;
    readonly forceRelease: boolean;
    readonly requireAdmissionRecheck?: boolean;
}
export interface FreezeSnapshotDefaults {
    readonly ackTimeoutMs: number;
    readonly snapshotDir: string;
}
export declare function createFreezeSignal(input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly now?: number;
    readonly ackTimeoutMs?: number;
    readonly blockingTask?: string;
    readonly blockingRoute?: string;
    readonly conflictingResource?: string;
}): FreezeSignal;
export declare function acknowledgeFreeze(signal: FreezeSignal, input?: {
    readonly now?: number;
}): FreezeAck;
export declare function resolveFreezeDecision(input: {
    readonly signal: FreezeSignal;
    readonly acknowledgedAt?: string | null;
    readonly now?: number;
}): FreezeResolution;
export declare function resumeFreeze(signal: FreezeSignal, input?: {
    readonly now?: number;
    readonly admissionRechecked?: boolean;
}): FreezeResolution;
export declare function markBlockedFallback(signal: FreezeSignal, input?: {
    readonly now?: number;
    readonly repeatedConflict?: {
        readonly blockingTask?: string;
        readonly blockingRoute?: string;
        readonly conflictingResource?: string;
    };
}): FreezeResolution;
export declare function resolveFreezeSnapshotDefaults(): FreezeSnapshotDefaults;

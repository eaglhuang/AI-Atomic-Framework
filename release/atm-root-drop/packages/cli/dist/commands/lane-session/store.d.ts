export declare const runtimeLaneSessionsRootRelativePath: ".atm/runtime/lane-sessions";
export type LaneSessionStatus = 'active' | 'handoff' | 'adopted' | 'released' | 'expired';
export type LaneSessionTtlPhase = 'fresh' | 'grace' | 'expired';
export interface LaneSessionIdentitySnapshot {
    readonly actorId: string;
    readonly editor: string | null;
    readonly gitName: string | null;
    readonly gitEmail: string | null;
    readonly provider: string | null;
    readonly activeSessionId: string | null;
}
export interface LaneSessionAdoptionSource {
    readonly kind: 'mint' | 'adoption' | 'handoff' | 'import';
    readonly sourceLaneId: string | null;
    readonly sourceActorId: string | null;
    readonly reason: string | null;
}
export interface LaneSessionLastCommand {
    readonly command: string;
    readonly executedAt: string;
    readonly exitCode: number | null;
}
export interface LaneSessionDocument {
    readonly schemaId: 'atm.laneSession.v1';
    readonly specVersion: '0.1.0';
    readonly laneId: string;
    readonly actorId: string;
    readonly taskId: string | null;
    readonly status: LaneSessionStatus;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly expiresAt: string;
    readonly ttlMs: number;
    readonly identity: LaneSessionIdentitySnapshot;
    readonly adoptionSource: LaneSessionAdoptionSource;
    readonly handoffTokenHash: string | null;
    readonly lastCommand: LaneSessionLastCommand | null;
    readonly lastHeartbeatAt: string | null;
}
export interface MintLaneSessionInput {
    readonly cwd: string;
    readonly actorId: string;
    readonly taskId?: string | null;
    readonly laneId?: string | null;
    readonly ttlMs: number;
    readonly status?: LaneSessionStatus;
    readonly timestamp?: string;
    readonly adoptionSource?: Partial<LaneSessionAdoptionSource> | null;
    readonly handoffToken?: string | null;
    readonly lastCommand?: LaneSessionLastCommand | null;
}
export interface AdoptLaneSessionInput {
    readonly cwd: string;
    readonly laneId: string;
    readonly actorId: string;
    readonly reason?: string | null;
    readonly timestamp?: string;
    readonly lastCommand?: LaneSessionLastCommand | null;
}
export interface RecordLaneSessionHeartbeatInput {
    readonly cwd: string;
    readonly laneId: string;
    readonly actorId?: string | null;
    readonly timestamp?: string;
    readonly lastCommand?: LaneSessionLastCommand | null;
}
export type LaneSessionHeartbeatFailureReason = 'not-found' | 'closed' | 'expired';
export type LaneSessionHeartbeatResult = {
    readonly ok: true;
    readonly session: LaneSessionDocument;
    readonly previousSession: LaneSessionDocument;
    readonly sessionPath: string;
    readonly ttlPhaseBefore: LaneSessionTtlPhase;
} | {
    readonly ok: false;
    readonly reason: LaneSessionHeartbeatFailureReason;
    readonly session: LaneSessionDocument | null;
    readonly ttlPhaseBefore: LaneSessionTtlPhase | null;
};
export interface LaneSessionSweepInput {
    readonly cwd: string;
    readonly now?: string;
    readonly graceMs?: number;
    readonly write?: boolean;
    readonly actorId?: string | null;
    readonly lastCommand?: LaneSessionLastCommand | null;
}
export interface LaneSessionSweepEntry {
    readonly laneId: string;
    readonly actorId: string;
    readonly taskId: string | null;
    readonly status: LaneSessionStatus;
    readonly updatedAt: string;
    readonly expiresAt: string;
    readonly ttlPhase: LaneSessionTtlPhase;
    readonly sweepable: boolean;
    readonly reason: string;
}
export interface LaneSessionSweepResult {
    readonly generatedAt: string;
    readonly graceMs: number;
    readonly write: boolean;
    readonly entries: readonly LaneSessionSweepEntry[];
    readonly staleCount: number;
    readonly sweptCount: number;
    readonly sweptSessions: readonly LaneSessionDocument[];
}
export type LaneSessionAdoptionFailureReason = 'not-found' | 'closed';
export type LaneSessionAdoptionResult = {
    readonly ok: true;
    readonly session: LaneSessionDocument;
    readonly previousSession: LaneSessionDocument;
    readonly sessionPath: string;
} | {
    readonly ok: false;
    readonly reason: LaneSessionAdoptionFailureReason;
    readonly session: LaneSessionDocument | null;
};
export declare function mintLaneSession(input: MintLaneSessionInput): {
    readonly session: LaneSessionDocument;
    readonly sessionPath: string;
};
export declare function adoptLaneSession(input: AdoptLaneSessionInput): LaneSessionAdoptionResult;
export declare function recordLaneSessionHeartbeat(input: RecordLaneSessionHeartbeatInput): LaneSessionHeartbeatResult;
export declare function inspectLaneSessionSweep(input: LaneSessionSweepInput): LaneSessionSweepResult;
export declare function sweepLaneSessions(input: LaneSessionSweepInput): LaneSessionSweepResult;
export declare function isLaneSessionAdoptable(session: LaneSessionDocument): boolean;
export declare function readLaneSession(cwd: string, laneId: string): LaneSessionDocument | null;
export declare function listLaneSessions(cwd: string): readonly LaneSessionDocument[];
export declare function classifyLaneSessionTtl(input: {
    readonly now?: string | Date;
    readonly expiresAt: string;
    readonly graceMs?: number;
}): LaneSessionTtlPhase;
export declare function hashHandoffToken(token: string): string;
export declare function laneSessionPathFor(cwd: string, laneId: string): string;
export declare function atomicWriteJson(filePath: string, value: unknown): void;

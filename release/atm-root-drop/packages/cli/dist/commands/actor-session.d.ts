export declare const runtimeSessionsRootRelativePath: ".atm/runtime/sessions";
export type ActorWorkSessionStatus = 'active' | 'released' | 'closed' | 'handoff' | 'taken_over';
export interface ActorWorkSessionDocument {
    readonly schemaId: 'atm.actorWorkSession.v1';
    readonly specVersion: '0.1.0';
    readonly sessionId: string;
    readonly actorId: string;
    readonly taskId: string;
    readonly claimLeaseId: string | null;
    readonly status: ActorWorkSessionStatus;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly heartbeatAt: string;
    readonly taskPath: string | null;
    readonly sourcePrompt: string | null;
    readonly batchId: string | null;
    readonly guidanceSessionId: string | null;
    readonly editor: string | null;
    readonly gitName: string | null;
    readonly gitEmail: string | null;
    readonly reason?: string | null;
    readonly releasedAt?: string | null;
    readonly closedAt?: string | null;
}
interface SessionUpsertInput {
    readonly cwd: string;
    readonly actorId: string;
    readonly taskId: string;
    readonly claimLeaseId?: string | null;
    readonly status?: ActorWorkSessionStatus;
    readonly taskPath?: string | null;
    readonly sourcePrompt?: string | null;
    readonly batchId?: string | null;
    readonly guidanceSessionId?: string | null;
    readonly editor?: string | null;
    readonly gitName?: string | null;
    readonly gitEmail?: string | null;
    readonly reason?: string | null;
    readonly timestamp?: string;
    readonly sessionId?: string | null;
}
interface SessionResolveCriteria {
    readonly actorId?: string | null;
    readonly taskId?: string | null;
    readonly claimLeaseId?: string | null;
    readonly sessionId?: string | null;
    readonly includeNonActive?: boolean;
}
export declare function readActorWorkSession(cwd: string, sessionId: string): ActorWorkSessionDocument | null;
export declare function listActorWorkSessions(cwd: string): readonly ActorWorkSessionDocument[];
export declare function resolveActorWorkSession(cwd: string, criteria: SessionResolveCriteria): ActorWorkSessionDocument | null;
export declare function upsertActorWorkSession(input: SessionUpsertInput): {
    readonly session: ActorWorkSessionDocument;
    readonly sessionPath: string;
};
export declare function updateActorWorkSessionState(input: {
    readonly cwd: string;
    readonly actorId?: string | null;
    readonly taskId?: string | null;
    readonly claimLeaseId?: string | null;
    readonly sessionId?: string | null;
    readonly status: ActorWorkSessionStatus;
    readonly reason?: string | null;
    readonly timestamp?: string;
}): {
    readonly session: ActorWorkSessionDocument;
    readonly sessionPath: string;
} | null;
/** Transfer active work-session authority after its lane is adopted. */
export declare function rebindActiveWorkSessionsForLane(input: {
    readonly cwd: string;
    readonly laneSessionId: string;
    readonly actorId: string;
    readonly timestamp?: string;
}): readonly ActorWorkSessionDocument[];
export {};

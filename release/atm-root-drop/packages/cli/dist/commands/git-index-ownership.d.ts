export type GitIndexOwnershipClass = 'current-task-owned' | 'foreign-active-owned' | 'foreign-released-or-abandoned' | 'unknown-governance-artifact' | 'ordinary-unowned';
export type GitIndexLaneStatus = 'free' | 'owned-by-task' | 'queued' | 'requires-staging-steward' | 'blocked-foreign-active-staged';
export interface GitIndexOwnershipEntry {
    readonly path: string;
    readonly ownership: GitIndexOwnershipClass;
    readonly ownerTaskId: string | null;
    readonly ownerActorId: string | null;
    readonly stagedBlobId: string | null;
    readonly stagedMode: string | null;
    readonly source: 'governance-path' | 'active-direction-lock' | 'ordinary';
}
export interface GitIndexOwnershipReport {
    readonly schemaId: 'atm.gitIndexOwnership.v1';
    readonly taskId: string | null;
    readonly generatedAt: string;
    readonly entries: readonly GitIndexOwnershipEntry[];
    readonly foreignActiveStaged: readonly GitIndexOwnershipEntry[];
    readonly indexLane: {
        readonly schemaId: 'atm.gitIndexLane.v1';
        readonly status: GitIndexLaneStatus;
        readonly ownerTaskId: string | null;
        readonly ownerActorId: string | null;
        readonly reason: string;
    };
}
export declare const ATM_INDEX_FOREIGN_ACTIVE_STAGED = "ATM_INDEX_FOREIGN_ACTIVE_STAGED";
export declare function inspectGitIndexOwnership(input: {
    readonly cwd: string;
    readonly taskId?: string | null;
    readonly stagedFiles?: readonly string[] | null;
}): GitIndexOwnershipReport;
export declare function buildForeignActiveStagedDiagnostic(report: GitIndexOwnershipReport): {
    code: string;
    ownerTaskIds: readonly string[];
    ownerActorIds: readonly string[];
    stagedPaths: string[];
    indexLane: {
        readonly schemaId: "atm.gitIndexLane.v1";
        readonly status: GitIndexLaneStatus;
        readonly ownerTaskId: string | null;
        readonly ownerActorId: string | null;
        readonly reason: string;
    };
    safeNextActions: string[];
    requiredCommand: string;
};

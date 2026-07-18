import type { ImportedTaskSummary } from './route-predicates.ts';
export interface ClaimDirtyWipAdmission {
    readonly schemaId: 'atm.claimDirtyWipAdmission.v1';
    readonly ok: boolean;
    readonly taskId: string;
    readonly currentActorId: string;
    readonly currentLaneSessionId: string | null;
    readonly candidateFiles: readonly string[];
    readonly intersectingFiles: readonly string[];
    readonly blockers: readonly ClaimDirtyWipBlocker[];
}
export interface ClaimDirtyWipBlocker {
    readonly file: string;
    readonly ownership: 'foreign' | 'unowned';
    readonly changeKinds: readonly ('staged' | 'unstaged' | 'untracked')[];
    readonly ownerTaskId: string | null;
    readonly ownerActorId: string | null;
    readonly ownerSessionId: string | null;
    readonly ownerLaneSessionId: string | null;
}
export declare function inspectClaimDirtyWipAdmission(input: {
    readonly cwd: string;
    readonly task: ImportedTaskSummary;
    readonly actorId: string;
    readonly laneSessionId?: string | null;
    readonly claimFiles: readonly string[];
}): ClaimDirtyWipAdmission;
export declare function assertClaimDirtyWipAdmission(input: {
    readonly cwd: string;
    readonly task: ImportedTaskSummary;
    readonly actorId: string;
    readonly laneSessionId?: string | null;
    readonly claimFiles: readonly string[];
}): ClaimDirtyWipAdmission;

import { type ClaimOwnerComparison } from '../next/claim-admission.ts';
import type { TaskClaimRecordWithLane } from './task-ledger-readers.ts';
export declare function readClaimLaneSessionId(claim: {
    readonly laneSession?: {
        readonly laneSessionId?: string | null;
    } | null;
} | null | undefined): string | null;
export declare function evaluateSameTaskClaimOwnership(input: {
    readonly currentActorId: string;
    readonly currentLaneSessionId?: string | null;
    readonly requestedActorId: string;
    readonly requestedLaneSessionId?: string | null;
}): ClaimOwnerComparison;
export declare function buildSameTaskClaimConflictDetails(input: {
    readonly taskId: string;
    readonly currentActorId: string;
    readonly requestedActorId: string;
    readonly leaseId?: string | null;
    readonly comparison: ClaimOwnerComparison;
}): Record<string, unknown>;
export declare function throwIfForeignSameTaskClaim(input: {
    readonly taskId: string;
    readonly currentActorId: string;
    readonly currentLaneSessionId?: string | null;
    readonly requestedActorId: string;
    readonly requestedLaneSessionId?: string | null;
    readonly leaseId?: string | null;
}): ClaimOwnerComparison;
export declare function throwIfClaimOwnerMismatch(input: {
    readonly taskId: string;
    readonly currentActorId: string;
    readonly currentLaneSessionId?: string | null;
    readonly requestedActorId: string;
    readonly requestedLaneSessionId?: string | null;
}): ClaimOwnerComparison;
export declare function assertCurrentClaimOwnerForAction(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly action: 'renew' | 'release' | 'handoff';
    readonly currentClaim: TaskClaimRecordWithLane;
}): import("../lane-session/resolve.ts").LaneSessionResolution;
export declare function throwIfNextClaimForeignActiveOwner(input: {
    readonly taskId: string;
    readonly existingClaimActorId: string | null | undefined;
    readonly existingClaimLaneSessionId?: string | null;
    readonly requestedActorId: string;
    readonly requestedLaneSessionId?: string | null;
    readonly actorResolution: {
        readonly repoDefaultActorId?: string | null;
    };
}): boolean;

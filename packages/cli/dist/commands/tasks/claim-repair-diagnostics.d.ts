import type { TaskClaimRecord } from '@ai-atomic-framework/core';
import { type ClaimOwnerComparisonMode } from '../next/claim-admission.ts';
export type ClaimRepairIssueKind = 'valid-active-claim' | 'expired-claim' | 'stale-running-without-claim' | 'stale-claim-released' | 'dangling-governance-lock' | 'dangling-direction-sidecar' | 'conflicting-lock-actor' | 'conflicting-session-lease' | 'orphaned-active-session';
export interface ClaimRepairIssue {
    readonly kind: ClaimRepairIssueKind;
    readonly severity: 'blocking' | 'repairable';
    readonly summary: string;
    readonly details?: Record<string, unknown>;
}
export interface ClaimLifecycleOwnerSummary {
    readonly ownerActorId: string | null;
    readonly claimActorId: string | null;
    readonly claimLaneSessionId: string | null;
    readonly sessionActorId: string | null;
    readonly sessionLaneSessionId: string | null;
    readonly lockActorId: string | null;
    readonly lockLaneSessionId: string | null;
    readonly comparisonMode: ClaimOwnerComparisonMode;
    readonly closeoutOwnerRule: string;
}
export interface ClaimRepairDiagnosis {
    readonly schemaId: 'atm.claimRepairDiagnosis.v1';
    readonly taskId: string;
    readonly status: string | null;
    readonly claim: TaskClaimRecord | null;
    readonly issues: readonly ClaimRepairIssue[];
    readonly repairable: boolean;
    readonly blocked: boolean;
    readonly lifecycleOwner: ClaimLifecycleOwnerSummary;
    readonly writeCommand: string | null;
}
export interface ClaimRepairApplyResult {
    readonly before: {
        readonly status: string | null;
        readonly claim: TaskClaimRecord | null;
    };
    readonly after: {
        readonly status: string | null;
        readonly claim: TaskClaimRecord | null;
    };
    readonly repairActions: readonly string[];
    readonly taskDocument: Record<string, unknown>;
}
export declare function buildRepairClaimCommand(input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly write?: boolean;
    readonly reason?: string | null;
}): string;
export declare function diagnoseClaimRepairState(cwd: string, taskId: string, actorId?: string | null): ClaimRepairDiagnosis;
export declare function applyClaimRepairWrite(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly actorId: string;
    readonly reason: string;
    readonly taskDocument: Record<string, unknown>;
    readonly diagnosis: ClaimRepairDiagnosis;
}): Promise<ClaimRepairApplyResult>;

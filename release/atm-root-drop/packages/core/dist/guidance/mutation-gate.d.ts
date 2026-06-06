import type { GuidanceSession } from './guidance-packet.ts';
export type MutationGateProfile = 'dev' | 'ci' | 'release';
export type MutationGateAction = string;
export interface MutationGateRequest {
    readonly action: MutationGateAction;
    readonly profile?: MutationGateProfile;
    readonly activeSession?: GuidanceSession | null;
    readonly isLegacyTarget?: boolean;
    readonly hasLegacyRoutePlan?: boolean;
    readonly hasDryRunProposal?: boolean;
    readonly hasRollbackProof?: boolean;
    readonly applyRequested?: boolean;
    readonly promoteRequested?: boolean;
    readonly reviewApproved?: boolean;
    readonly releaseBlockers?: readonly string[];
    readonly targetSegmentRole?: 'trunk' | 'leaf' | 'adapter-boundary' | 'unknown';
    readonly unguided?: boolean;
    readonly unguidedReason?: string | null;
}
export interface MutationGateIssue {
    readonly code: GuidanceMutationErrorCode;
    readonly message: string;
    readonly details: Readonly<Record<string, unknown>>;
}
export interface MutationGateResult {
    readonly allowed: boolean;
    readonly advisory: boolean;
    readonly auditRequired: boolean;
    readonly issues: readonly MutationGateIssue[];
}
export type GuidanceMutationErrorCode = 'ATM_GUIDANCE_SESSION_REQUIRED' | 'ATM_GUIDANCE_LEGACY_PLAN_REQUIRED' | 'ATM_GUIDANCE_PROPOSAL_REQUIRED' | 'ATM_GUIDANCE_REVIEW_REQUIRED' | 'ATM_GUIDANCE_ROLLBACK_PROOF_REQUIRED' | 'ATM_GUIDANCE_RELEASE_BLOCKER' | 'ATM_GUIDANCE_TRUNK_MUTATION_BLOCKED' | 'ATM_GUIDANCE_UNGUIDED_FORBIDDEN' | 'ATM_GUIDANCE_NEXT_NOT_UNIQUE';
export declare function evaluateMutationGate(request: MutationGateRequest): MutationGateResult;
export declare function assertUniqueNextAction(nextActions: readonly unknown[]): MutationGateResult;
export declare function explainGuidanceIssue(code: GuidanceMutationErrorCode): MutationGateIssue;

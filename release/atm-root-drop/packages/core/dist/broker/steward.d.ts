import type { StewardApplyEvidence } from './apply-evidence.ts';
import type { VirtualAtomInUseRegistryDocument } from './registry.ts';
import type { TeamBrokerRuntimeActivationHandshakeEvidence } from './team-lane.ts';
import type { DecompositionRequest, MergePlan, PatchProposal } from './types.ts';
export type StewardArbitrationVerdict = 'apply' | 'merge-required' | 'blocked' | 'human-required';
export type StewardValidationCode = 'scope-lock-mismatch' | 'stale-base-commit' | 'file-hash-drift' | 'invalid-merge-plan' | 'out-of-scope-target' | 'blocked-merge-plan' | 'missing-proposal' | 'invalid-steward-identity' | 'human-review-required';
export interface StewardValidationIssue {
    readonly code: StewardValidationCode;
    readonly detail: string;
}
export interface StewardPlanStep {
    readonly proposalId: string;
    readonly targetFile: string;
    readonly applyMethod: MergePlan['applyMethod'];
}
export interface StewardPlan {
    readonly schemaId: 'atm.stewardPlan.v1';
    readonly specVersion: '0.1.0';
    readonly stewardId: string;
    readonly mergePlanId: string;
    readonly ok: boolean;
    readonly steps: readonly StewardPlanStep[];
    readonly targetFiles: readonly string[];
    readonly issues: readonly StewardValidationIssue[];
}
export interface StewardPlanResult {
    readonly ok: boolean;
    readonly plan: StewardPlan;
}
export interface StewardApplyResult {
    readonly ok: boolean;
    readonly evidence: StewardApplyEvidence;
}
export interface StewardIdentity {
    /** The steward's identifier (e.g. 'neutral-write-steward', 'runner-broker'). */
    readonly stewardId: string;
    /** The type of steward. 'neutral' is the default; 'derived-artifact-writer'
     *  is a specialized path for ATM core Runner Broker scoped writes. */
    readonly kind: 'neutral' | 'derived-artifact-writer';
    /** The route or task that authorised this steward session. */
    readonly authorisedByRouteId?: string;
    readonly authorisedByTaskId?: string;
}
export interface StewardPermissionCheckResult {
    readonly ok: boolean;
    readonly stewardId: string;
    readonly kind: StewardIdentity['kind'];
    readonly issues: readonly StewardValidationIssue[];
}
/**
 * Validates that a steward identity is well-formed and authorised.
 * Derived-artifact writers must declare a route or task authorisation.
 */
export declare function checkStewardPermission(identity: StewardIdentity): StewardPermissionCheckResult;
export interface StewardArbitrationResult {
    readonly schemaId: 'atm.stewardArbitrationResult.v1';
    readonly specVersion: '0.1.0';
    readonly stewardId: string;
    readonly verdict: StewardArbitrationVerdict;
    readonly owningRouteId: string | null;
    readonly owningTaskId: string | null;
    readonly plan: StewardPlan | null;
    readonly applyEvidence: StewardApplyEvidence | null;
    readonly issues: readonly StewardValidationIssue[];
}
export interface BrokerScopedWriteExecutionEvidence {
    readonly schemaId: 'atm.brokerScopedWriteExecution.v1';
    readonly specVersion: '0.1.0';
    readonly stewardId: string;
    readonly mergePlanId: string;
    readonly allowedFiles: readonly string[];
    readonly handshake: TeamBrokerRuntimeActivationHandshakeEvidence;
    readonly decompositionRequest: DecompositionRequest | null;
    readonly virtualAtomInUseRegistry: VirtualAtomInUseRegistryDocument;
    readonly applyEvidence: StewardApplyEvidence | null;
    readonly verdict: 'applied' | 'blocked';
    readonly blockedReasons: readonly string[];
}
export interface BrokerScopedWriteExecutionResult {
    readonly ok: boolean;
    readonly evidence: BrokerScopedWriteExecutionEvidence;
}
export declare function planStewardApply(input: {
    readonly cwd: string;
    readonly stewardId: string;
    readonly mergePlan: MergePlan;
    readonly proposals: readonly PatchProposal[];
    readonly scopeFiles: readonly string[];
}): StewardPlanResult;
export declare function applyStewardPlan(input: {
    readonly cwd: string;
    readonly stewardId: string;
    readonly mergePlan: MergePlan;
    readonly proposals: readonly PatchProposal[];
    readonly scopeFiles: readonly string[];
    readonly evidenceOutPath?: string | null;
}): StewardApplyResult;
export declare function executeBrokerScopedWrite(input: {
    readonly cwd: string;
    readonly stewardId: string;
    readonly mergePlan: MergePlan;
    readonly proposals: readonly PatchProposal[];
    readonly scopeFiles: readonly string[];
    readonly handshake: TeamBrokerRuntimeActivationHandshakeEvidence;
    readonly evidenceOutPath?: string | null;
}): BrokerScopedWriteExecutionResult;
export declare function arbitrateStewardRequest(input: {
    readonly cwd: string;
    readonly identity: StewardIdentity;
    readonly mergePlan: MergePlan;
    readonly proposals: readonly PatchProposal[];
    readonly scopeFiles: readonly string[];
    readonly owningRouteId?: string | null;
    readonly owningTaskId?: string | null;
    readonly evidenceOutPath?: string | null;
}): StewardArbitrationResult;
export declare function applyUnifiedPatch(content: string, patch: string): string;
export declare function readGitHeadCommit(cwd: string): string | null;

import type { StewardApplyEvidence } from './apply-evidence.ts';
import type { VirtualAtomInUseRegistryDocument } from './registry.ts';
import type { TeamBrokerRuntimeActivationHandshakeEvidence } from './team-lane.ts';
import type { DecompositionRequest, MergePlan, PatchProposal } from './types.ts';
export type StewardValidationCode = 'scope-lock-mismatch' | 'stale-base-commit' | 'file-hash-drift' | 'invalid-merge-plan' | 'out-of-scope-target' | 'blocked-merge-plan' | 'missing-proposal';
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
export declare function applyUnifiedPatch(content: string, patch: string): string;
export declare function readGitHeadCommit(cwd: string): string | null;

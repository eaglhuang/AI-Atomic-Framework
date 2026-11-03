/**
 * The topology guard deliberately knows nothing about Git commands or broker
 * scheduling.  A physical file overlap is a logical-intent decision; Git
 * topology must not become a second arbitration mechanism.
 */
export type WorkspaceTopologyPurpose = 'normal-development' | 'emergency-anomaly-recovery' | 'historical-read-only-discrimination' | 'non-development-sealed-packaging';
export type WorkspaceTopologyOperation = 'submit-proposal' | 'apply-shared-delivery' | 'read-only';
export type WorkspaceTopologyVerdict = 'canonical-development' | 'documented-exception' | 'rejected-noncanonical-development' | 'rejected-direct-worker-write' | 'rejected-missing-exception-receipt' | 'rejected-unsupported-purpose';
export interface WorkspaceTopologyPolicyInput {
    readonly canonicalWorktreeRoot: string;
    readonly executionWorktreeRoot: string;
    readonly purpose: WorkspaceTopologyPurpose;
    readonly operation: WorkspaceTopologyOperation;
    readonly actorRole: 'worker' | 'neutral-steward';
    readonly exceptionReceiptId?: string | null;
}
export interface WorkspaceTopologyPolicyDecision {
    readonly allowed: boolean;
    readonly verdict: WorkspaceTopologyVerdict;
    readonly reason: string;
}
export declare function evaluateWorkspaceTopologyPolicy(input: WorkspaceTopologyPolicyInput): WorkspaceTopologyPolicyDecision;

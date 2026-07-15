export type GovernanceChannel = 'fast' | 'normal' | 'batch';
export type GovernanceReadinessFrameworkStatus = {
    readonly repoIdentity: {
        readonly isFrameworkRepo: boolean;
    };
};
export declare function buildGovernanceReadinessHintContract(input: {
    readonly cwd: string;
    readonly channel: GovernanceChannel | null;
    readonly prompt: string;
    readonly taskId?: string | null;
    readonly actorId?: string | null;
    readonly ownFiles?: readonly string[];
    readonly frameworkClaimRequired?: boolean;
    readonly uniqueSorted: (values: readonly string[]) => string[];
    readonly readTaskWorkFiles: (cwd: string, taskId: string) => string[];
    readonly buildActiveWorkSummary: (cwd: string, actorId?: string | null, ownFiles?: readonly string[]) => unknown;
    readonly createFrameworkModeStatus: (input: {
        cwd: string;
    }) => GovernanceReadinessFrameworkStatus;
    readonly isFrameworkMaintenancePrompt: (prompt: string) => boolean;
    readonly isProtectedFrameworkBranchTarget: (branch: string) => boolean;
}): {
    schemaId: "atm.nextGovernanceReadinessHint.v1";
    channel: GovernanceChannel | null;
    currentBranch: string | null;
    upstreamRef: string | null;
    protectedBranchTarget: boolean;
    aheadCount: number;
    frameworkClaimRequired: boolean;
    activeWorkSummary: unknown;
    earlyPreparation: string[];
    queueRetryCodes: readonly ["ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY", "ATM_GIT_COMMIT_BRANCH_QUEUE_RACE"];
    perCriticalCommitGitHeadEvidence: {
        enforcement: string;
        retainedStrictBoundaries: string[];
    };
    protectedPushHint: string | null;
};

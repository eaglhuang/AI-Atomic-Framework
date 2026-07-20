export declare function buildGovernanceReadinessHint(cwd: string, input: {
    readonly channel: GovernanceChannel | null;
    readonly prompt: string;
    readonly taskId?: string | null;
    readonly actorId?: string | null;
    readonly ownFiles?: readonly string[];
    readonly frameworkClaimRequired?: boolean;
}): {
    schemaId: "atm.nextGovernanceReadinessHint.v1";
    channel: import("../governance-readiness.ts").GovernanceChannel | null;
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
export declare function shouldInspectCrossRepoFrameworkStatus(cwd: string, targetRepo: string | null): boolean;

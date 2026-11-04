export type TeamContributionManifest = {
    readonly schemaId: 'atm.teamContributionManifest.v1';
    readonly contributionId: string;
    readonly taskId: string;
    readonly role: string;
    readonly workerId: string;
    readonly baseCommit: string;
    readonly contextManifestDigest: string;
    readonly overlayDigest: string;
    readonly changedFiles: readonly string[];
    readonly validatorReceipts: readonly string[];
    readonly reviewerReceipt: TeamReviewerReceipt | null;
};
export type TeamReviewerReceipt = {
    readonly schemaId: 'atm.teamReviewerReceipt.v1';
    readonly reviewerRole: string;
    readonly cleanContext: true;
    readonly readSet: readonly ['base', 'contribution-manifest', 'diff', 'required-dependencies', 'acceptance-criteria', 'reviewer-context-manifest'];
    readonly receiptDigest: string;
};
export declare function createTeamContributionManifest(input: {
    readonly taskId: string;
    readonly role: string;
    readonly workerId: string;
    readonly baseCommit: string;
    readonly contextManifestDigest: string;
    readonly overlay: unknown;
    readonly changedFiles: readonly string[];
    readonly validatorReceipts?: readonly string[];
    readonly reviewerReceipt?: TeamReviewerReceipt | null;
}): TeamContributionManifest;
export declare function createCleanContextReviewerReceipt(input: {
    readonly reviewerRole: string;
    readonly contributionDigest: string;
    readonly reviewerContextDigest: string;
}): TeamReviewerReceipt;

export interface FrameworkCommitRangeBaseline {
    readonly schemaId: 'atm.frameworkCommitRangeBaseline.v1';
    readonly generatedAt: string;
    readonly name: string | null;
    readonly refName: string | null;
    readonly commitSha: string;
    readonly acceptedHistoryThroughCommitSha: string;
    readonly strictEvidenceRequiredAfterCommitSha: string;
    readonly rationale: string | null;
}
export declare function readFrameworkCommitRangeBaseline(cwd: string, headRef: string): FrameworkCommitRangeBaseline | null;
export declare function isCommitAcceptedByLegacyBaseline(cwd: string, commitSha: string, baselineCommitSha: string): boolean;
export declare function isAncestorCommit(cwd: string, maybeAncestor: string, maybeDescendant: string): boolean;

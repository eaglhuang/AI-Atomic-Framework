export declare function isFileAllowedInTaskBundle(input: {
    readonly filePath: string;
    readonly declaredScope: readonly string[];
    readonly allowedGovernanceArtifact: boolean;
}): boolean;
export declare function buildTaskScopedCommitFileSet(input: {
    readonly inScopeStagedFiles: readonly string[];
    readonly inScopeStagedDeletions: readonly string[];
    readonly stageCandidates: readonly string[];
    readonly uniqueSorted: (values: readonly string[]) => readonly string[];
}): readonly string[];

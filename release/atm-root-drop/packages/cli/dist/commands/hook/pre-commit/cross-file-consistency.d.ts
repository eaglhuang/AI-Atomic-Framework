export interface PreCommitBlockingFinding {
    readonly code: string;
    readonly source: string;
    readonly detail: string;
    readonly file?: string;
    readonly files?: readonly string[];
    readonly requiredCommand?: string | null;
    readonly classification?: 'environment' | 'baseline' | 'current-task' | 'blocking';
    readonly blockerKind?: 'governance-state' | 'content-validation' | 'environment' | 'baseline';
    readonly scope?: 'staged' | 'tree-wide';
    readonly data?: unknown;
}
export declare function checkStageTimeCrossFileConsistency(input: {
    readonly root: string;
    readonly stagedFiles: readonly string[];
    readonly isBrokerResolutionAuthorizedDependencyDeferral: (cwd: string, dependencyPath: string) => boolean;
}): PreCommitBlockingFinding[];

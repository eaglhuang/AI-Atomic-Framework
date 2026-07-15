export type TeamPromptCachePolicy = 'stable-prefix-preferred' | 'cache-disabled';
export type TeamContextManifest = {
    readonly schemaId: 'atm.teamContextManifest.v1';
    readonly manifestId: string;
    readonly taskId: string;
    readonly role: string;
    readonly baseCommit: string;
    readonly scopeEpoch: number;
    readonly allowedFiles: readonly string[];
    readonly acceptanceCriteria: readonly string[];
    readonly requiredDependencies: readonly string[];
    readonly promptCachePolicy: TeamPromptCachePolicy;
    readonly stablePromptPrefixHash: string | null;
    readonly digest: string;
};
export declare function createTeamContextManifest(input: {
    readonly taskId: string;
    readonly role: string;
    readonly baseCommit: string;
    readonly scopeEpoch: number;
    readonly allowedFiles: readonly string[];
    readonly acceptanceCriteria: readonly string[];
    readonly requiredDependencies?: readonly string[];
    readonly promptCachePolicy?: TeamPromptCachePolicy;
    readonly stablePromptPrefix?: string | null;
}): TeamContextManifest;

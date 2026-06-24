export type TeamRoleProviderOverride = {
    readonly providerId: string;
    readonly sdkId: string;
    readonly modelId: string;
    readonly runtimeMode: 'real-agent' | 'editor-subagent' | 'broker-only';
};
export type TeamProviderSelectionConfig = {
    readonly repoDefault: TeamRoleProviderOverride;
    readonly roleOverrides: Readonly<Record<string, TeamRoleProviderOverride>>;
};
export type TeamProviderSelectionDecision = TeamRoleProviderOverride & {
    readonly role: string;
    readonly source: 'repo-default' | 'role-override';
};
export declare function resolveTeamProviderSelection(role: string, config: TeamProviderSelectionConfig): TeamProviderSelectionDecision;

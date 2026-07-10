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
    readonly source: 'repo-default' | 'role-override' | 'cli-role-override';
};
export type TeamProviderSelectionConfigSource = {
    readonly schemaId: 'atm.teamAgentsConfig.v1';
    readonly path: string | null;
    readonly loaded: boolean;
};
export declare function resolveTeamProviderSelection(role: string, config: TeamProviderSelectionConfig): TeamProviderSelectionDecision;
export declare function mergeTeamProviderSelectionConfig(input: {
    readonly repoConfig?: Partial<TeamProviderSelectionConfig> | null;
    readonly cliRoleOverrides?: readonly string[];
}): TeamProviderSelectionConfig;
export declare function parseRoleProviderOverride(value: string): {
    role: string;
    override: TeamRoleProviderOverride;
} | null;

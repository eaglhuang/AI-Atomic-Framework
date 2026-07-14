import { type TeamProviderSelectionConfig, type TeamRoleProviderOverride } from '../../../../core/src/team-runtime/provider-selection.ts';
export type TeamProviderSelectionSource = {
    schemaId: 'atm.teamAgentsConfig.v1';
    path: string | null;
    loaded: boolean;
    cliOverrideCount: number;
};
export type TeamProviderSelectionConfigLoadResult = {
    config: TeamProviderSelectionConfig;
    source: TeamProviderSelectionSource;
};
export declare function loadTeamProviderSelectionConfigFromRepo(cwd: string, cliRoleOverrides: string[], cliGlobalDefault?: Partial<TeamRoleProviderOverride> | null): TeamProviderSelectionConfigLoadResult;
export declare function resolveTeamRuntimeProviderSelection(input: {
    roleName: string;
    selectionConfig?: TeamProviderSelectionConfig | null;
    runtimeMode: string;
    providerId?: string | null;
    sdkId?: string | null;
    modelId?: string | null;
    explicitRuntimeMode?: boolean;
    explicitProviderId?: boolean;
    explicitSdkId?: boolean;
    explicitModelId?: boolean;
}): {
    selectionDecision: import("../../../../core/src/team-runtime/provider-selection.ts").TeamProviderSelectionDecision | null;
    runtimeMode: string;
    providerId: string | null | undefined;
    sdkId: string | null | undefined;
    modelId: string | null | undefined;
};

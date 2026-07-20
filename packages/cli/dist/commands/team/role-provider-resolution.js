import path from 'node:path';
import { existsSync } from 'node:fs';
import { readJsonFile } from '../shared.js';
import { mergeTeamProviderSelectionConfig, resolveTeamProviderSelection } from '../../../../core/dist/team-runtime/provider-selection.js';
export function loadTeamProviderSelectionConfigFromRepo(cwd, cliRoleOverrides, cliGlobalDefault) {
    const configPath = path.join(cwd, '.atm', 'config', 'team-provider-selection.json');
    const loaded = existsSync(configPath);
    const repoConfig = loaded
        ? readJsonFile(configPath, 'ATM_TEAM_PROVIDER_SELECTION_CONFIG_INVALID')
        : null;
    return {
        config: mergeTeamProviderSelectionConfig({
            repoConfig,
            cliRoleOverrides,
            cliGlobalDefault
        }),
        source: {
            schemaId: 'atm.teamAgentsConfig.v1',
            path: loaded ? path.relative(cwd, configPath).replace(/\\/g, '/') : null,
            loaded,
            cliOverrideCount: cliRoleOverrides.length
        }
    };
}
export function resolveTeamRuntimeProviderSelection(input) {
    const selectionDecision = input.selectionConfig
        ? resolveTeamProviderSelection(input.roleName, input.selectionConfig)
        : null;
    const selectionIsRoleOverride = selectionDecision?.source === 'role-override'
        || selectionDecision?.source === 'cli-role-override';
    return {
        selectionDecision,
        runtimeMode: selectionIsRoleOverride
            ? selectionDecision.runtimeMode
            : (input.explicitRuntimeMode ? input.runtimeMode : (selectionDecision?.runtimeMode ?? input.runtimeMode)),
        providerId: selectionIsRoleOverride
            ? selectionDecision.providerId
            : (input.explicitProviderId ? input.providerId : (input.providerId ?? selectionDecision?.providerId)),
        sdkId: selectionIsRoleOverride
            ? selectionDecision.sdkId
            : (input.explicitSdkId ? input.sdkId : (input.sdkId ?? selectionDecision?.sdkId)),
        modelId: selectionIsRoleOverride
            ? selectionDecision.modelId
            : (input.explicitModelId ? input.modelId : (input.modelId ?? selectionDecision?.modelId))
    };
}

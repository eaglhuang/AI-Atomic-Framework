import path from 'node:path';
import { existsSync } from 'node:fs';
import { readJsonFile } from '../shared.ts';
import {
  mergeTeamProviderSelectionConfig,
  resolveTeamProviderSelection,
  type TeamProviderSelectionConfig,
  type TeamRoleProviderOverride
} from '../../../../core/src/team-runtime/provider-selection.ts';

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

export function loadTeamProviderSelectionConfigFromRepo(
  cwd: string,
  cliRoleOverrides: string[],
  cliGlobalDefault?: Partial<TeamRoleProviderOverride> | null
): TeamProviderSelectionConfigLoadResult {
  const configPath = path.join(cwd, '.atm', 'config', 'team-provider-selection.json');
  const loaded = existsSync(configPath);
  const repoConfig = loaded
    ? readJsonFile(configPath, 'ATM_TEAM_PROVIDER_SELECTION_CONFIG_INVALID') as Partial<TeamProviderSelectionConfig>
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

export function resolveTeamRuntimeProviderSelection(input: {
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
}) {
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

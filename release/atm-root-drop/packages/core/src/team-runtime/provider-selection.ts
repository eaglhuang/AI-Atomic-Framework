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

export function resolveTeamProviderSelection(
  role: string,
  config: TeamProviderSelectionConfig
): TeamProviderSelectionDecision {
  const override = config.roleOverrides[role];
  if (override) {
    return {
      role,
      source: 'role-override',
      ...override
    };
  }
  return {
    role,
    source: 'repo-default',
    ...config.repoDefault
  };
}

export function mergeTeamProviderSelectionConfig(input: {
  readonly repoConfig?: Partial<TeamProviderSelectionConfig> | null;
  readonly cliRoleOverrides?: readonly string[];
}): TeamProviderSelectionConfig {
  const repoDefault = normalizeOverride(input.repoConfig?.repoDefault) ?? {
    providerId: 'openai',
    sdkId: 'responses',
    modelId: 'gpt-5-mini',
    runtimeMode: 'broker-only' as const
  };
  const roleOverrides: Record<string, TeamRoleProviderOverride> = {};
  for (const [role, override] of Object.entries(input.repoConfig?.roleOverrides ?? {})) {
    const normalized = normalizeOverride(override);
    if (normalized) roleOverrides[role] = normalized;
  }
  for (const rawOverride of input.cliRoleOverrides ?? []) {
    const parsed = parseRoleProviderOverride(rawOverride);
    if (parsed) roleOverrides[parsed.role] = parsed.override;
  }
  return {
    repoDefault,
    roleOverrides
  };
}

export function parseRoleProviderOverride(value: string): { role: string; override: TeamRoleProviderOverride } | null {
  const [rolePart, providerPart] = String(value ?? '').split('=');
  const role = rolePart?.trim();
  const providerSpec = providerPart?.trim();
  if (!role || !providerSpec) return null;
  const segments = providerSpec.split(':').map((entry) => entry.trim());
  if (segments.length > 4) return null;
  const [providerId, modelId, sdkSegment, runtimeSegment] = segments;
  if (!providerId || !modelId) return null;
  if (runtimeSegment && !isRuntimeMode(runtimeSegment)) return null;
  return {
    role,
    override: {
      providerId,
      modelId,
      sdkId: sdkSegment || providerId,
      runtimeMode: normalizeRuntimeMode(runtimeSegment)
    }
  };
}

function isRuntimeMode(value: string): value is TeamRoleProviderOverride['runtimeMode'] {
  return value === 'real-agent' || value === 'editor-subagent' || value === 'broker-only';
}

function normalizeOverride(value: unknown): TeamRoleProviderOverride | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<TeamRoleProviderOverride>;
  const providerId = String(record.providerId ?? '').trim();
  const sdkId = String(record.sdkId ?? providerId).trim();
  const modelId = String(record.modelId ?? '').trim();
  if (!providerId || !sdkId || !modelId) return null;
  return {
    providerId,
    sdkId,
    modelId,
    runtimeMode: normalizeRuntimeMode(record.runtimeMode)
  };
}

function normalizeRuntimeMode(value: unknown): TeamRoleProviderOverride['runtimeMode'] {
  const normalized = String(value ?? '').trim();
  if (isRuntimeMode(normalized)) {
    return normalized;
  }
  return 'broker-only';
}

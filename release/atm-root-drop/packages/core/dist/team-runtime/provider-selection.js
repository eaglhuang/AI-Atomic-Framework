export function resolveTeamProviderSelection(role, config) {
    const override = config.roleOverrides[role];
    if (override) {
        return {
            role,
            source: config.cliRoleOverrideRoles?.has(role) ? 'cli-role-override' : 'role-override',
            ...override
        };
    }
    return {
        role,
        source: config.defaultSource ?? 'repo-default',
        ...config.repoDefault
    };
}
export function mergeTeamProviderSelectionConfig(input) {
    const baseRepoDefault = normalizeOverride(input.repoConfig?.repoDefault) ?? {
        providerId: 'openai',
        sdkId: 'responses',
        modelId: 'gpt-5-mini',
        runtimeMode: 'broker-only'
    };
    const cliGlobal = normalizePartialOverride(input.cliGlobalDefault);
    const repoDefault = cliGlobal ? mergeProviderOverrides(baseRepoDefault, cliGlobal) : baseRepoDefault;
    const roleOverrides = {};
    const cliRoleOverrideRoles = new Set();
    for (const [role, override] of Object.entries(input.repoConfig?.roleOverrides ?? {})) {
        const normalized = normalizeOverride(override);
        if (normalized)
            roleOverrides[role] = normalized;
    }
    for (const rawOverride of input.cliRoleOverrides ?? []) {
        const parsed = parseRoleProviderOverride(rawOverride);
        if (parsed) {
            roleOverrides[parsed.role] = parsed.override;
            cliRoleOverrideRoles.add(parsed.role);
        }
    }
    return {
        repoDefault,
        roleOverrides,
        defaultSource: cliGlobal ? 'cli-global-default' : 'repo-default',
        cliRoleOverrideRoles
    };
}
export function parseRoleProviderOverride(value) {
    const [rolePart, providerPart] = String(value ?? '').split('=');
    const role = rolePart?.trim();
    const providerSpec = providerPart?.trim();
    if (!role || !providerSpec)
        return null;
    const segments = providerSpec.split(':').map((entry) => entry.trim());
    if (segments.length > 4)
        return null;
    const [providerId, modelId, sdkSegment, runtimeSegment] = segments;
    if (!providerId || !modelId)
        return null;
    if (runtimeSegment && !isRuntimeMode(runtimeSegment))
        return null;
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
function isRuntimeMode(value) {
    return value === 'real-agent' || value === 'editor-subagent' || value === 'broker-only';
}
function normalizePartialOverride(value) {
    if (!value || typeof value !== 'object')
        return null;
    const record = value;
    const providerId = String(record.providerId ?? '').trim();
    const sdkId = String(record.sdkId ?? '').trim();
    const modelId = String(record.modelId ?? '').trim();
    const runtimeMode = String(record.runtimeMode ?? '').trim();
    const partial = {};
    if (providerId)
        partial.providerId = providerId;
    if (sdkId)
        partial.sdkId = sdkId;
    if (modelId)
        partial.modelId = modelId;
    if (runtimeMode && isRuntimeMode(runtimeMode))
        partial.runtimeMode = runtimeMode;
    return Object.keys(partial).length > 0 ? partial : null;
}
function mergeProviderOverrides(base, overlay) {
    return {
        providerId: overlay.providerId ?? base.providerId,
        sdkId: overlay.sdkId ?? base.sdkId,
        modelId: overlay.modelId ?? base.modelId,
        runtimeMode: overlay.runtimeMode ?? base.runtimeMode
    };
}
function normalizeOverride(value) {
    if (!value || typeof value !== 'object')
        return null;
    const record = value;
    const providerId = String(record.providerId ?? '').trim();
    const sdkId = String(record.sdkId ?? providerId).trim();
    const modelId = String(record.modelId ?? '').trim();
    if (!providerId || !sdkId || !modelId)
        return null;
    return {
        providerId,
        sdkId,
        modelId,
        runtimeMode: normalizeRuntimeMode(record.runtimeMode)
    };
}
function normalizeRuntimeMode(value) {
    const normalized = String(value ?? '').trim();
    if (isRuntimeMode(normalized)) {
        return normalized;
    }
    return 'broker-only';
}

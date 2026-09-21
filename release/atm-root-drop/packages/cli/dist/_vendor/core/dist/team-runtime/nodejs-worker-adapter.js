export const NODEJS_REFERENCE_WORKER_ADAPTER_ID = 'atm.node.reference-worker';
export const BROKER_ONLY_FALLBACK_ADAPTER_ID = 'atm.node.broker-only-fallback';
export const EDITOR_SUBAGENT_BRIDGE_ADAPTER_ID = 'atm.editor.subagent-bridge';
export function resolveNodejsTeamWorkerAdapter(input) {
    const runtimeMode = normalizeTeamWorkerRuntimeMode(input.runtimeMode);
    const runtimeLanguage = normalizeOptionalString(input.runtimeLanguage) ?? 'node';
    const providerId = normalizeOptionalString(input.providerId) ?? 'local';
    const sdkId = normalizeOptionalString(input.sdkId) ?? (runtimeMode === 'real-agent' ? 'nodejs' : 'none');
    const modelId = normalizeOptionalString(input.modelId) ?? (runtimeMode === 'real-agent' ? 'provider-selected' : 'none');
    const adapterId = normalizeOptionalString(input.runtimeAdapterId) ?? defaultAdapterIdForMode(runtimeMode);
    const executionSurface = executionSurfaceForMode(runtimeMode);
    const agentsSpawned = runtimeMode !== 'broker-only';
    return {
        schemaId: 'atm.teamWorkerAdapterContract.v1',
        adapterId,
        runtimeMode,
        runtimeLanguage,
        executionSurface,
        providerId,
        sdkId,
        modelId,
        spawnStrategy: runtimeMode === 'real-agent'
            ? 'spawn-worker'
            : runtimeMode === 'editor-subagent'
                ? 'editor-managed'
                : 'disabled',
        agentsSpawned,
        brokerFallback: {
            enabled: runtimeMode === 'broker-only',
            reason: runtimeMode === 'broker-only'
                ? 'agent spawning disabled; broker governance remains authoritative'
                : null,
            preservesGovernance: [
                'broker',
                'permission-leases',
                'validators',
                'police',
                'evidence',
                'artifact-contract',
                'retry-contract'
            ]
        },
        authorityBoundary: {
            gitWrite: false,
            taskLifecycle: false,
            selfClose: false,
            evidenceWriteOwner: 'coordinator'
        },
        vendorNeutral: true,
        artifactContractPreserved: true,
        retryContractPreserved: true
    };
}
function normalizeTeamWorkerRuntimeMode(value) {
    const normalized = String(value ?? 'broker-only').trim();
    if (normalized === 'real-agent' || normalized === 'editor-subagent' || normalized === 'broker-only') {
        return normalized;
    }
    return 'broker-only';
}
function normalizeOptionalString(value) {
    const normalized = String(value ?? '').trim();
    return normalized.length > 0 ? normalized : null;
}
function defaultAdapterIdForMode(runtimeMode) {
    if (runtimeMode === 'real-agent')
        return NODEJS_REFERENCE_WORKER_ADAPTER_ID;
    if (runtimeMode === 'editor-subagent')
        return EDITOR_SUBAGENT_BRIDGE_ADAPTER_ID;
    return BROKER_ONLY_FALLBACK_ADAPTER_ID;
}
function executionSurfaceForMode(runtimeMode) {
    if (runtimeMode === 'real-agent')
        return 'agent-runtime';
    if (runtimeMode === 'editor-subagent')
        return 'editor-subagent';
    return 'broker-governance';
}

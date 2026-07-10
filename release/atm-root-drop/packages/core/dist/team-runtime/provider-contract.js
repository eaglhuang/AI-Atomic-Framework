export const TEAM_PROVIDER_IDS = [
    'openai',
    'anthropic',
    'azure-openai',
    'claude-code',
    'gemini',
    'microsoft-foundry'
];
export function createTeamProviderMetadata(providerId) {
    return {
        providerId,
        displayName: providerId,
        supportedRuntimeModes: ['real-agent', 'editor-subagent', 'broker-only'],
        supportedArtifacts: ['agent-report', 'validator-report', 'evidence-summary'],
        vendorNeutral: true
    };
}
export function createTeamProviderContract(providerId) {
    return {
        schemaId: 'atm.teamProviderContract.v1',
        metadata: createTeamProviderMetadata(providerId),
        sessionLifecycle: {
            createSession: true,
            closeSession: true,
            cancelSession: true,
            retryStep: true
        },
        openSession(request) {
            return {
                sessionId: `${request.taskId}:${request.role}:${providerId}:${request.modelId}`,
                providerId
            };
        },
        closeSession(sessionId) {
            return {
                closed: true,
                sessionId
            };
        },
        cancelSession(sessionId, reason) {
            return {
                cancelled: true,
                sessionId,
                reason
            };
        }
    };
}
export function supportsVendorNeutralProviders(metadata) {
    const seen = new Set(metadata.map((entry) => entry.providerId));
    return TEAM_PROVIDER_IDS.every((providerId) => seen.has(providerId));
}

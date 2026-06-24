export declare const TEAM_PROVIDER_IDS: readonly ["openai", "azure-openai", "claude-code", "gemini", "microsoft-foundry"];
export type TeamProviderId = typeof TEAM_PROVIDER_IDS[number];
export type TeamProviderSessionLifecycle = {
    readonly createSession: true;
    readonly closeSession: true;
    readonly cancelSession: true;
    readonly retryStep: true;
};
export type TeamProviderMetadata = {
    readonly providerId: TeamProviderId;
    readonly displayName: string;
    readonly supportedRuntimeModes: readonly ('real-agent' | 'editor-subagent' | 'broker-only')[];
    readonly supportedArtifacts: readonly string[];
    readonly vendorNeutral: true;
};
export type TeamProviderSessionRequest = {
    readonly taskId: string;
    readonly role: string;
    readonly runtimeMode: 'real-agent' | 'editor-subagent' | 'broker-only';
    readonly providerId: TeamProviderId;
    readonly sdkId: string;
    readonly modelId: string;
};
export type TeamProviderStepResult = {
    readonly ok: boolean;
    readonly providerId: TeamProviderId;
    readonly role: string;
    readonly artifacts: readonly string[];
    readonly retryable: boolean;
    readonly summary: string;
};
export interface TeamProviderContract {
    readonly schemaId: 'atm.teamProviderContract.v1';
    readonly metadata: TeamProviderMetadata;
    readonly sessionLifecycle: TeamProviderSessionLifecycle;
    openSession(request: TeamProviderSessionRequest): {
        sessionId: string;
        providerId: TeamProviderId;
    };
    closeSession(sessionId: string): {
        closed: true;
        sessionId: string;
    };
    cancelSession(sessionId: string, reason: string): {
        cancelled: true;
        sessionId: string;
        reason: string;
    };
}
export declare function createTeamProviderMetadata(providerId: TeamProviderId): TeamProviderMetadata;
export declare function createTeamProviderContract(providerId: TeamProviderId): TeamProviderContract;
export declare function supportsVendorNeutralProviders(metadata: TeamProviderMetadata[]): boolean;

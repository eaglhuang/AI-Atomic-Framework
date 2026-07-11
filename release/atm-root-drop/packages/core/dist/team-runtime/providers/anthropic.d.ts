import { type TeamPermissionPolicy } from '../permission-broker.ts';
import { type TeamProviderContract, type TeamProviderHttpExecutor, type TeamProviderSessionRequest } from '../provider-contract.ts';
import { type OpenAIFamilyBridgeRunResult, type OpenAIFamilyRunArtifact } from './openai.ts';
export type AnthropicTeamProviderConfig = {
    readonly schemaId: 'atm.anthropicTeamProviderConfig.v1';
    readonly providerId: 'anthropic';
    readonly sdkId: 'anthropic-messages';
    readonly modelId: string;
    readonly apiKeyEnvVar: string;
    readonly baseUrlEnvVar?: string | null;
};
export type AnthropicTeamProviderConfigValidation = {
    readonly schemaId: 'atm.anthropicTeamProviderConfigValidation.v1';
    readonly providerId: 'anthropic';
    readonly ok: boolean;
    readonly missingFields: readonly string[];
    readonly requiredFields: readonly string[];
    readonly optionalFields: readonly string[];
    readonly secretRefFields: readonly string[];
    readonly rawSecretsLogged: false;
};
export type AnthropicTeamProviderBridge = TeamProviderContract & {
    readonly bridgeSchemaId: 'atm.anthropicTeamProviderBridge.v1';
    readonly config: AnthropicTeamProviderConfig;
    readonly configValidation: AnthropicTeamProviderConfigValidation;
    readonly secretRefFields: readonly string[];
};
export declare function validateAnthropicTeamProviderConfig(config: Partial<AnthropicTeamProviderConfig>): AnthropicTeamProviderConfigValidation;
export declare function createAnthropicTeamProviderBridge(config: AnthropicTeamProviderConfig): AnthropicTeamProviderBridge;
export declare function launchAnthropicTeamProviderRun(input: {
    readonly bridge: AnthropicTeamProviderBridge;
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'real-agent';
        readonly providerId: 'anthropic';
    };
    readonly permissionPolicy: TeamPermissionPolicy;
    readonly scopedPaths: readonly string[];
    readonly executor?: TeamProviderHttpExecutor;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
    readonly emittedAt?: string;
}): Promise<OpenAIFamilyBridgeRunResult & {
    readonly providerId: 'anthropic';
    readonly artifact: OpenAIFamilyRunArtifact & {
        readonly providerId: 'anthropic';
    };
}>;
export declare function buildAnthropicTeamProviderBridgeDescriptor(): {
    schemaId: string;
    providerId: string;
    bridgeSchemaId: string;
    configSchemaId: string;
    supportedRuntimeModes: readonly ["real-agent", "broker-only"];
    requiredConfigRefs: readonly ["modelId", "apiKeyEnvVar"];
    optionalConfigRefs: readonly ["baseUrlEnvVar"];
    authModes: readonly ["api-key-env"];
    executionReadiness: "vendor-execution-ready";
    executionSurface: "anthropic-messages-http";
    brokerCheckedPermissions: readonly ["exec.validator"];
    artifactType: string;
    observabilityEventTypes: readonly ["session.start", "artifact.output", "session.complete"];
    sharedBrokerVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
    rawSecretsLogged: false;
};

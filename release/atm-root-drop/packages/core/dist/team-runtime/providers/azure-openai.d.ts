import { type TeamPermissionPolicy } from '../permission-broker.ts';
import { type OpenAIFamilyBridgeRunResult } from './openai.ts';
import { type TeamProviderContract, type TeamProviderExecutionResult, type TeamProviderHttpExecutor, type TeamProviderSessionRequest } from '../provider-contract.ts';
export type AzureOpenAIAuthMode = 'api-key-env' | 'managed-identity';
export type AzureOpenAITeamProviderConfig = {
    readonly schemaId: 'atm.azureOpenAITeamProviderConfig.v1';
    readonly providerId: 'azure-openai';
    readonly sdkId: 'azure-openai-responses';
    readonly deploymentName: string;
    readonly endpointEnvVar: string;
    readonly modelId: string;
    readonly authMode: AzureOpenAIAuthMode;
    readonly apiKeyEnvVar?: string | null;
    readonly tenantIdEnvVar?: string | null;
};
export type AzureOpenAITeamProviderConfigValidation = {
    readonly schemaId: 'atm.azureOpenAITeamProviderConfigValidation.v1';
    readonly providerId: 'azure-openai';
    readonly ok: boolean;
    readonly authMode: AzureOpenAIAuthMode | null;
    readonly missingFields: readonly string[];
    readonly requiredFields: readonly string[];
    readonly secretRefFields: readonly string[];
    readonly rawSecretsLogged: false;
};
export type AzureOpenAITeamProviderBridge = TeamProviderContract & {
    readonly bridgeSchemaId: 'atm.azureOpenAITeamProviderBridge.v1';
    readonly config: AzureOpenAITeamProviderConfig;
    readonly configValidation: AzureOpenAITeamProviderConfigValidation;
    readonly secretRefFields: readonly string[];
};
export declare function validateAzureOpenAITeamProviderConfig(config: Partial<AzureOpenAITeamProviderConfig>): AzureOpenAITeamProviderConfigValidation;
export declare function createAzureOpenAITeamProviderBridge(config: AzureOpenAITeamProviderConfig): AzureOpenAITeamProviderBridge;
export declare function launchAzureOpenAITeamProviderRun(input: {
    readonly bridge: AzureOpenAITeamProviderBridge;
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'real-agent';
        readonly providerId: 'azure-openai';
    };
    readonly permissionPolicy: TeamPermissionPolicy;
    readonly scopedPaths: readonly string[];
    readonly executor?: TeamProviderHttpExecutor;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
    readonly emittedAt?: string;
}): Promise<OpenAIFamilyBridgeRunResult>;
export declare function executeAzureOpenAIResponses(input: {
    readonly config: AzureOpenAITeamProviderConfig;
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'real-agent';
        readonly providerId: 'azure-openai';
    };
    readonly sessionId: string;
    readonly scopedPaths: readonly string[];
    readonly executor?: TeamProviderHttpExecutor;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult>;
export declare function buildAzureOpenAITeamProviderBridgeDescriptor(): {
    schemaId: string;
    providerId: string;
    bridgeSchemaId: string;
    configSchemaId: string;
    supportedRuntimeModes: readonly ["real-agent", "broker-only"];
    requiredConfigRefs: readonly ["endpointEnvVar", "deploymentName", "modelId", "authMode"];
    authModes: readonly ["api-key-env", "managed-identity"];
    executionReadiness: "vendor-execution-ready";
    executionSurface: "azure-openai-responses-http";
    brokerCheckedPermissions: readonly ["exec.validator"];
    artifactType: string;
    observabilityEventTypes: readonly ["session.start", "artifact.output", "session.complete"];
    sharedBrokerVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
    rawSecretsLogged: false;
};

import { type TeamPermissionPolicy } from '../permission-broker.ts';
import { type OpenAIFamilyBridgeRunResult, type OpenAIFamilyRunArtifact } from './openai.ts';
import { type TeamProviderContract, type TeamProviderExecutionResult, type TeamProviderHttpExecutor, type TeamProviderSessionRequest } from '../provider-contract.ts';
export type MicrosoftFoundrySurface = 'project-chat-inference' | 'agent-service';
export type MicrosoftFoundryBaseConfig = {
    readonly schemaId: 'atm.microsoftFoundryTeamProviderConfig.v1';
    readonly providerId: 'microsoft-foundry';
    readonly sdkId: 'microsoft-foundry';
    readonly surface: MicrosoftFoundrySurface;
    readonly modelId: string;
    readonly projectEndpointEnvVar: string;
    readonly tenantIdEnvVar?: string | null;
};
export type MicrosoftFoundryChatInferenceConfig = MicrosoftFoundryBaseConfig & {
    readonly surface: 'project-chat-inference';
    readonly deploymentName: string;
};
export type MicrosoftFoundryAgentServiceConfig = MicrosoftFoundryBaseConfig & {
    readonly surface: 'agent-service';
    readonly agentIdEnvVar: string;
};
export type MicrosoftFoundryTeamProviderConfig = MicrosoftFoundryChatInferenceConfig | MicrosoftFoundryAgentServiceConfig;
export type MicrosoftFoundryTeamProviderConfigValidation = {
    readonly schemaId: 'atm.microsoftFoundryTeamProviderConfigValidation.v1';
    readonly providerId: 'microsoft-foundry';
    readonly ok: boolean;
    readonly surface: MicrosoftFoundrySurface | null;
    readonly missingFields: readonly string[];
    readonly requiredFields: readonly string[];
    readonly secretRefFields: readonly string[];
    readonly rawSecretsLogged: false;
};
export type MicrosoftFoundryTeamProviderBridge = TeamProviderContract & {
    readonly bridgeSchemaId: 'atm.microsoftFoundryTeamProviderBridge.v1';
    readonly config: MicrosoftFoundryTeamProviderConfig;
    readonly configValidation: MicrosoftFoundryTeamProviderConfigValidation;
    readonly secretRefFields: readonly string[];
    readonly surface: MicrosoftFoundrySurface;
};
export type MicrosoftFoundryRunArtifact = OpenAIFamilyRunArtifact & {
    readonly providerId: 'microsoft-foundry';
    readonly foundrySurface: MicrosoftFoundrySurface;
    readonly foundryConfigRefs: {
        readonly projectEndpointEnvVar: string;
        readonly deploymentName?: string;
        readonly agentIdEnvVar?: string;
        readonly tenantIdEnvVar?: string | null;
    };
};
export type MicrosoftFoundryBridgeRunResult = Omit<OpenAIFamilyBridgeRunResult, 'providerId' | 'artifact'> & {
    readonly providerId: 'microsoft-foundry';
    readonly artifact: MicrosoftFoundryRunArtifact;
};
export declare function validateMicrosoftFoundryTeamProviderConfig(config: Partial<MicrosoftFoundryTeamProviderConfig>): MicrosoftFoundryTeamProviderConfigValidation;
export declare function createMicrosoftFoundryTeamProviderBridge(config: MicrosoftFoundryTeamProviderConfig): MicrosoftFoundryTeamProviderBridge;
export declare function launchMicrosoftFoundryTeamProviderRun(input: {
    readonly bridge: MicrosoftFoundryTeamProviderBridge;
    readonly config: MicrosoftFoundryTeamProviderConfig;
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'real-agent';
        readonly providerId: 'microsoft-foundry';
    };
    readonly permissionPolicy: TeamPermissionPolicy;
    readonly scopedPaths: readonly string[];
    readonly executor?: TeamProviderHttpExecutor;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
    readonly emittedAt?: string;
}): Promise<MicrosoftFoundryBridgeRunResult>;
export declare function executeMicrosoftFoundryProvider(input: {
    readonly config: MicrosoftFoundryTeamProviderConfig;
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'real-agent';
        readonly providerId: 'microsoft-foundry';
    };
    readonly sessionId: string;
    readonly scopedPaths: readonly string[];
    readonly executor?: TeamProviderHttpExecutor;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult>;
export declare function buildMicrosoftFoundryTeamProviderBridgeDescriptor(): {
    schemaId: string;
    providerId: string;
    bridgeSchemaId: string;
    configSchemaId: string;
    supportedSurfaces: readonly ["project-chat-inference", "agent-service"];
    supportedRuntimeModes: readonly ["real-agent", "broker-only"];
    requiredConfigRefs: {
        base: readonly ["surface", "modelId", "projectEndpointEnvVar"];
        projectChatInference: readonly ["deploymentName"];
        agentService: readonly ["agentIdEnvVar"];
    };
    authModes: readonly ["project-endpoint-env", "managed-identity"];
    executionReadiness: "vendor-execution-ready";
    executionSurface: "microsoft-foundry-http";
    brokerCheckedPermissions: readonly ["exec.validator"];
    artifactType: string;
    observabilityEventTypes: readonly ["session.start", "artifact.output", "session.complete"];
    sharedBrokerVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
    rawSecretsLogged: false;
};

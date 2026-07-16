import { type TeamPermissionPolicy } from '../permission-broker.ts';
import { type TeamObservabilityEvent } from '../observability.ts';
import { type TeamProviderContract, type TeamProviderBillableUsage, type TeamProviderExecutionResult, type TeamProviderHttpExecutor, type TeamProviderId, type TeamProviderSessionRequest } from '../provider-contract.ts';
export type OpenAITeamProviderConfig = {
    readonly schemaId: 'atm.openaiTeamProviderConfig.v1';
    readonly providerId: 'openai';
    readonly sdkId: 'openai-responses';
    readonly modelId: string;
    readonly apiKeyEnvVar: string;
    readonly baseUrlEnvVar?: string | null;
    readonly organizationEnvVar?: string | null;
    readonly projectEnvVar?: string | null;
};
export type OpenAITeamProviderConfigValidation = {
    readonly schemaId: 'atm.openaiTeamProviderConfigValidation.v1';
    readonly providerId: 'openai';
    readonly ok: boolean;
    readonly missingFields: readonly string[];
    readonly requiredFields: readonly string[];
    readonly optionalFields: readonly string[];
    readonly secretRefFields: readonly string[];
    readonly rawSecretsLogged: false;
};
export type OpenAIFamilyRunArtifact = {
    readonly schemaId: 'atm.teamProviderRunArtifact.v1';
    readonly specVersion: '0.1.0';
    readonly artifactType: 'atm.teamProviderRunArtifact.v1';
    readonly taskId: string;
    readonly role: string;
    readonly providerId: TeamProviderId;
    readonly sdkId: string;
    readonly modelId: string;
    readonly runtimeMode: 'real-agent';
    readonly sessionId: string;
    readonly permissionDecision: {
        readonly ok: boolean;
        readonly permission: string;
        readonly reason: string;
    };
    readonly outputArtifacts: readonly string[];
    readonly execution: {
        readonly mode: 'vendor-api';
        readonly statusCode?: number;
        readonly retryable: boolean;
        readonly outputTextPreview: string;
    };
    readonly billableUsage?: TeamProviderBillableUsage;
    readonly observabilityEventCount: number;
    readonly redaction: {
        readonly rawSecretsLogged: false;
        readonly secretRefFields: readonly string[];
    };
};
export type OpenAIFamilyBridgeRunResult = {
    readonly schemaId: 'atm.teamProviderBridgeRunResult.v1';
    readonly ok: boolean;
    readonly providerId: TeamProviderId;
    readonly sessionId: string;
    readonly artifact: OpenAIFamilyRunArtifact;
    readonly observabilityEvents: readonly TeamObservabilityEvent[];
};
export type OpenAITeamProviderBridge = TeamProviderContract & {
    readonly bridgeSchemaId: 'atm.openaiTeamProviderBridge.v1';
    readonly config: OpenAITeamProviderConfig;
    readonly configValidation: OpenAITeamProviderConfigValidation;
    readonly secretRefFields: readonly string[];
};
export declare function validateOpenAITeamProviderConfig(config: Partial<OpenAITeamProviderConfig>): OpenAITeamProviderConfigValidation;
export declare function createOpenAITeamProviderBridge(config: OpenAITeamProviderConfig): OpenAITeamProviderBridge;
export declare function launchOpenAITeamProviderRun(input: {
    readonly bridge: OpenAITeamProviderBridge;
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'real-agent';
    };
    readonly permissionPolicy: TeamPermissionPolicy;
    readonly scopedPaths: readonly string[];
    readonly executor?: TeamProviderHttpExecutor;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
    readonly emittedAt?: string;
}): Promise<OpenAIFamilyBridgeRunResult>;
export declare function buildOpenAITeamProviderBridgeDescriptor(): {
    schemaId: string;
    providerId: string;
    bridgeSchemaId: string;
    configSchemaId: string;
    supportedRuntimeModes: readonly ["real-agent", "broker-only"];
    requiredConfigRefs: readonly ["modelId", "apiKeyEnvVar"];
    optionalConfigRefs: readonly ["baseUrlEnvVar", "organizationEnvVar", "projectEnvVar"];
    authModes: readonly ["api-key-env"];
    executionReadiness: "vendor-execution-ready";
    executionSurface: "openai-responses-http";
    brokerCheckedPermissions: readonly ["exec.validator"];
    artifactType: string;
    observabilityEventTypes: readonly ["session.start", "artifact.output", "session.complete"];
    sharedBrokerVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
    rawSecretsLogged: false;
};
export declare function executeOpenAIResponses(input: {
    readonly config: OpenAITeamProviderConfig | null;
    readonly fallbackConfig: OpenAITeamProviderConfig | null;
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'real-agent';
    };
    readonly sessionId: string;
    readonly scopedPaths: readonly string[];
    readonly executor?: TeamProviderHttpExecutor;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult>;
export declare function createOpenAIFamilyRunArtifact(input: {
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'real-agent';
    };
    readonly sessionId: string;
    readonly permissionDecision: {
        readonly ok: boolean;
        readonly permission: string;
        readonly reason: string;
    };
    readonly secretRefFields: readonly string[];
    readonly execution: TeamProviderExecutionResult;
}): OpenAIFamilyRunArtifact;
export declare function createOpenAIFamilyObservabilityEvents(input: {
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'real-agent';
    };
    readonly artifact: OpenAIFamilyRunArtifact;
    readonly emittedAt?: string;
}): TeamObservabilityEvent[];
export declare function defaultHttpJsonExecutor(input: {
    readonly url: string;
    readonly method: 'POST';
    readonly headers: Record<string, string>;
    readonly body: unknown;
    readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult>;
export declare function extractOpenAIResponsesBillableUsage(value: unknown): TeamProviderBillableUsage | undefined;
export declare function normalizeHttpExecutionResult(result: TeamProviderExecutionResult, label: string): TeamProviderExecutionResult;
export declare function missingSecretResult(secretRef: string, label: string): TeamProviderExecutionResult;
export declare function blockedExecutionResult(): TeamProviderExecutionResult;
export declare function normalizeBaseUrl(value: string | null | undefined, fallback: string): string;
export declare function extractProviderText(value: unknown): string;

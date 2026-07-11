import { type TeamPermissionPolicy } from '../permission-broker.ts';
import { type TeamObservabilityEvent } from '../observability.ts';
import { type TeamProviderContract, type TeamProviderExecutionResult, type TeamProviderHttpExecutor, type TeamProviderSessionRequest } from '../provider-contract.ts';
export type GeminiDirectTeamProviderConfig = {
    readonly schemaId: 'atm.geminiDirectTeamProviderConfig.v1';
    readonly providerId: 'gemini-direct';
    readonly sdkId: 'gemini-generate-content';
    readonly modelId: string;
    readonly apiKeyEnvVar: string;
    readonly baseUrlEnvVar?: string | null;
};
export type GeminiDirectTeamProviderBridge = TeamProviderContract & {
    readonly bridgeSchemaId: 'atm.geminiDirectTeamProviderBridge.v1';
    readonly config: GeminiDirectTeamProviderConfig;
    readonly secretRefFields: readonly string[];
};
export declare function createGeminiDirectTeamProviderBridge(config: GeminiDirectTeamProviderConfig): GeminiDirectTeamProviderBridge;
export declare function launchGeminiDirectTeamProviderRun(input: {
    readonly bridge: GeminiDirectTeamProviderBridge;
    readonly request: TeamProviderSessionRequest & {
        readonly providerId: 'gemini-direct';
        readonly runtimeMode: 'real-agent';
    };
    readonly permissionPolicy: TeamPermissionPolicy;
    readonly scopedPaths: readonly string[];
    readonly executor?: TeamProviderHttpExecutor;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
    readonly emittedAt?: string;
}): Promise<{
    schemaId: "atm.teamProviderBridgeRunResult.v1";
    ok: boolean;
    providerId: "gemini-direct";
    sessionId: string;
    artifact: {
        schemaId: "atm.teamProviderRunArtifact.v1";
        specVersion: "0.1.0";
        artifactType: "atm.teamProviderRunArtifact.v1";
        taskId: string;
        role: string;
        providerId: "gemini-direct";
        sdkId: string;
        modelId: string;
        runtimeMode: "real-agent";
        sessionId: string;
        permissionDecision: import("../permission-broker.ts").TeamPermissionDecision;
        outputArtifacts: readonly string[];
        execution: {
            mode: "vendor-api";
            statusCode: number | undefined;
            retryable: boolean;
            outputTextPreview: string;
        };
        observabilityEventCount: number;
        redaction: {
            rawSecretsLogged: false;
            secretRefFields: readonly string[];
        };
    };
    observabilityEvents: TeamObservabilityEvent[];
}>;
export declare function executeGeminiGenerateContent(input: {
    readonly config: GeminiDirectTeamProviderConfig;
    readonly request: TeamProviderSessionRequest & {
        readonly providerId: 'gemini-direct';
        readonly runtimeMode: 'real-agent';
    };
    readonly executor?: TeamProviderHttpExecutor;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult>;
export declare function buildGeminiDirectTeamProviderBridgeDescriptor(): {
    schemaId: string;
    providerId: string;
    bridgeSchemaId: string;
    configSchemaId: string;
    supportedRuntimeModes: readonly ["real-agent", "broker-only"];
    requiredConfigRefs: readonly ["modelId", "apiKeyEnvVar"];
    optionalConfigRefs: readonly ["baseUrlEnvVar"];
    authModes: readonly ["api-key-env"];
    executionReadiness: "vendor-execution-ready";
    executionSurface: "gemini-generate-content-http";
    brokerCheckedPermissions: readonly ["exec.validator"];
    artifactType: string;
    observabilityEventTypes: readonly ["session.start", "artifact.output", "session.complete"];
    sharedBrokerVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
    rawSecretsLogged: false;
};

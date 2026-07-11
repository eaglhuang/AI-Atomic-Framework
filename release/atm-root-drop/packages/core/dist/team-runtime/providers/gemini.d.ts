import { type TeamPermissionPolicy } from '../permission-broker.ts';
import { type TeamExecutionBridgeRunResult } from './claude-code.ts';
import { type TeamProviderContract, type TeamProviderCommandExecutor, type TeamProviderExecutionResult, type TeamProviderSessionRequest } from '../provider-contract.ts';
export type GeminiTeamProviderConfig = {
    readonly schemaId: 'atm.geminiTeamProviderConfig.v1';
    readonly providerId: 'gemini';
    readonly sdkId: 'gemini-cli';
    readonly modelId: string;
    readonly cliCommand: string;
    readonly roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1';
};
export type GeminiTeamProviderConfigValidation = {
    readonly schemaId: 'atm.geminiTeamProviderConfigValidation.v1';
    readonly providerId: 'gemini';
    readonly ok: boolean;
    readonly missingFields: readonly string[];
    readonly requiredFields: readonly string[];
    readonly secretRefFields: readonly string[];
    readonly rawSecretsLogged: false;
};
export type GeminiTeamProviderBridge = TeamProviderContract & {
    readonly bridgeSchemaId: 'atm.geminiTeamProviderBridge.v1';
    readonly config: GeminiTeamProviderConfig;
    readonly configValidation: GeminiTeamProviderConfigValidation;
    readonly secretRefFields: readonly string[];
    readonly executionSurface: 'cli-style';
};
export declare function validateGeminiTeamProviderConfig(config: Partial<GeminiTeamProviderConfig>): GeminiTeamProviderConfigValidation;
export declare function createGeminiTeamProviderBridge(config: GeminiTeamProviderConfig): GeminiTeamProviderBridge;
export declare function launchGeminiTeamProviderRun(input: {
    readonly bridge: GeminiTeamProviderBridge;
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'editor-subagent';
        readonly providerId: 'gemini';
    };
    readonly permissionPolicy: TeamPermissionPolicy;
    readonly scopedPaths: readonly string[];
    readonly permissionLeases?: readonly string[];
    readonly executor?: TeamProviderCommandExecutor;
    readonly cwd?: string;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
    readonly emittedAt?: string;
}): Promise<TeamExecutionBridgeRunResult>;
export declare function executeGeminiCommand(input: {
    readonly config: GeminiTeamProviderConfig;
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'editor-subagent';
        readonly providerId: 'gemini';
    };
    readonly sessionId: string;
    readonly scopedPaths: readonly string[];
    readonly permissionLeases: readonly string[];
    readonly executor?: TeamProviderCommandExecutor;
    readonly cwd?: string;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult>;
export declare function buildGeminiTeamProviderBridgeDescriptor(): {
    schemaId: string;
    providerId: string;
    bridgeSchemaId: string;
    configSchemaId: string;
    roleEnvelopeSchemaId: string;
    executionSurface: "cli-style";
    supportedRuntimeModes: readonly ["editor-subagent", "broker-only"];
    requiredConfigRefs: readonly ["modelId", "cliCommand", "roleEnvelopeSchemaId"];
    authModes: readonly ["cli-auth"];
    executionReadiness: "vendor-execution-ready";
    brokerCheckedPermissions: readonly ["exec.validator"];
    artifactType: string;
    observabilityEventTypes: readonly ["session.start", "artifact.output", "session.complete"];
    sharedBrokerVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
    rawSecretsLogged: false;
};

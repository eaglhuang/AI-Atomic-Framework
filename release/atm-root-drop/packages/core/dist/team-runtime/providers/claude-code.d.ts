import { type TeamPermissionPolicy } from '../permission-broker.ts';
import { type TeamObservabilityEvent } from '../observability.ts';
import { type TeamProviderContract, type TeamProviderCommandExecutor, type TeamProviderExecutionResult, type TeamProviderId, type TeamProviderSessionRequest } from '../provider-contract.ts';
export type TeamExecutionBridgeSurface = 'editor-subagent' | 'cli-style';
export type TeamEditorSubagentRoleEnvelope = {
    readonly schemaId: 'atm.teamEditorSubagentRoleEnvelope.v1';
    readonly taskId: string;
    readonly role: string;
    readonly providerId: TeamProviderId;
    readonly sdkId: string;
    readonly modelId: string;
    readonly runtimeMode: 'editor-subagent';
    readonly executionSurface: TeamExecutionBridgeSurface;
    readonly allowedFiles: readonly string[];
    readonly permissionLeases: readonly string[];
    readonly coordinatorOwnedAuthority: true;
    readonly brokerConflictVocabulary: readonly ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'];
};
export type TeamExecutionBridgeRunArtifact = {
    readonly schemaId: 'atm.teamProviderRunArtifact.v1';
    readonly specVersion: '0.1.0';
    readonly artifactType: 'atm.teamProviderRunArtifact.v1';
    readonly taskId: string;
    readonly role: string;
    readonly providerId: TeamProviderId;
    readonly sdkId: string;
    readonly modelId: string;
    readonly runtimeMode: 'editor-subagent';
    readonly sessionId: string;
    readonly roleEnvelope: TeamEditorSubagentRoleEnvelope;
    readonly permissionDecision: {
        readonly ok: boolean;
        readonly permission: string;
        readonly reason: string;
    };
    readonly outputArtifacts: readonly string[];
    readonly execution: {
        readonly mode: 'editor-cli';
        readonly statusCode?: number;
        readonly retryable: boolean;
        readonly outputTextPreview: string;
    };
    readonly observabilityEventCount: number;
    readonly redaction: {
        readonly rawSecretsLogged: false;
        readonly secretRefFields: readonly string[];
    };
};
export type TeamExecutionBridgeRunResult = {
    readonly schemaId: 'atm.teamProviderBridgeRunResult.v1';
    readonly ok: boolean;
    readonly providerId: TeamProviderId;
    readonly sessionId: string;
    readonly artifact: TeamExecutionBridgeRunArtifact;
    readonly observabilityEvents: readonly TeamObservabilityEvent[];
};
export type ClaudeCodeTeamProviderConfig = {
    readonly schemaId: 'atm.claudeCodeTeamProviderConfig.v1';
    readonly providerId: 'claude-code';
    readonly sdkId: 'claude-code-editor-subagent';
    readonly modelId: string;
    readonly editorCommand: string;
    readonly roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1';
};
export type ClaudeCodeTeamProviderConfigValidation = {
    readonly schemaId: 'atm.claudeCodeTeamProviderConfigValidation.v1';
    readonly providerId: 'claude-code';
    readonly ok: boolean;
    readonly missingFields: readonly string[];
    readonly requiredFields: readonly string[];
    readonly secretRefFields: readonly string[];
    readonly rawSecretsLogged: false;
};
export type ClaudeCodeTeamProviderBridge = TeamProviderContract & {
    readonly bridgeSchemaId: 'atm.claudeCodeTeamProviderBridge.v1';
    readonly config: ClaudeCodeTeamProviderConfig;
    readonly configValidation: ClaudeCodeTeamProviderConfigValidation;
    readonly secretRefFields: readonly string[];
    readonly executionSurface: 'editor-subagent';
};
export declare function validateClaudeCodeTeamProviderConfig(config: Partial<ClaudeCodeTeamProviderConfig>): ClaudeCodeTeamProviderConfigValidation;
export declare function createClaudeCodeTeamProviderBridge(config: ClaudeCodeTeamProviderConfig): ClaudeCodeTeamProviderBridge;
export declare function launchClaudeCodeTeamProviderRun(input: {
    readonly bridge: ClaudeCodeTeamProviderBridge;
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'editor-subagent';
        readonly providerId: 'claude-code';
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
export declare function executeClaudeCodeCommand(input: {
    readonly config: ClaudeCodeTeamProviderConfig;
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'editor-subagent';
        readonly providerId: 'claude-code';
    };
    readonly sessionId: string;
    readonly scopedPaths: readonly string[];
    readonly permissionLeases: readonly string[];
    readonly executor?: TeamProviderCommandExecutor;
    readonly cwd?: string;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult>;
export declare function buildClaudeCodeTeamProviderBridgeDescriptor(): {
    schemaId: string;
    providerId: string;
    bridgeSchemaId: string;
    configSchemaId: string;
    roleEnvelopeSchemaId: string;
    executionSurface: "editor-subagent";
    supportedRuntimeModes: readonly ["editor-subagent", "broker-only"];
    requiredConfigRefs: readonly ["modelId", "editorCommand", "roleEnvelopeSchemaId"];
    authModes: readonly ["editor-session"];
    executionReadiness: "vendor-execution-ready";
    brokerCheckedPermissions: readonly ["exec.validator"];
    artifactType: string;
    observabilityEventTypes: readonly ["session.start", "artifact.output", "session.complete"];
    sharedBrokerVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
    rawSecretsLogged: false;
};
export declare function createTeamExecutionBridgeRunArtifact(input: {
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'editor-subagent';
    };
    readonly sessionId: string;
    readonly executionSurface: TeamExecutionBridgeSurface;
    readonly allowedFiles: readonly string[];
    readonly permissionLeases: readonly string[];
    readonly permissionDecision: {
        readonly ok: boolean;
        readonly permission: string;
        readonly reason: string;
    };
    readonly secretRefFields: readonly string[];
    readonly execution: TeamProviderExecutionResult;
}): TeamExecutionBridgeRunArtifact;
export declare function createTeamExecutionBridgeObservabilityEvents(input: {
    readonly request: TeamProviderSessionRequest & {
        readonly runtimeMode: 'editor-subagent';
    };
    readonly artifact: TeamExecutionBridgeRunArtifact;
    readonly emittedAt?: string;
}): TeamObservabilityEvent[];
export declare function assertEditorExecutionRequest(request: TeamProviderSessionRequest, providerId: TeamProviderId): void;
export declare function blockedCommandExecutionResult(): TeamProviderExecutionResult;
export declare function defaultCommandExecutor(input: {
    readonly command: string;
    readonly args: readonly string[];
    readonly cwd?: string;
    readonly env?: Record<string, string | undefined>;
    readonly timeoutMs?: number;
    readonly stdin: string;
}): Promise<TeamProviderExecutionResult>;

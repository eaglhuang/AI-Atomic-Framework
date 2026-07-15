import { buildAnthropicTeamProviderBridgeDescriptor } from '../../../../core/src/team-runtime/providers/anthropic.ts';
import { buildAzureOpenAITeamProviderBridgeDescriptor } from '../../../../core/src/team-runtime/providers/azure-openai.ts';
import { buildClaudeCodeTeamProviderBridgeDescriptor } from '../../../../core/src/team-runtime/providers/claude-code.ts';
import { buildGeminiTeamProviderBridgeDescriptor } from '../../../../core/src/team-runtime/providers/gemini.ts';
import { buildMicrosoftFoundryTeamProviderBridgeDescriptor } from '../../../../core/src/team-runtime/providers/microsoft-foundry.ts';
import { buildOpenAITeamProviderBridgeDescriptor } from '../../../../core/src/team-runtime/providers/openai.ts';
type TeamOpenAIFamilyRuntimeBridgeSummary = {
    schemaId: 'atm.openAIFamilyRuntimeBridgeSummary.v1';
    milestone: 'M9I';
    providerIds: readonly ['openai', 'azure-openai'];
    sharedProviderInterface: 'atm.teamProviderContract.v1';
    sharedArtifactType: 'atm.teamProviderRunArtifact.v1';
    observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1';
    coordinatorOwnedAuthority: true;
    brokerConflictVocabulary: readonly ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'];
    bridges: readonly [
        ReturnType<typeof buildOpenAITeamProviderBridgeDescriptor>,
        ReturnType<typeof buildAzureOpenAITeamProviderBridgeDescriptor>
    ];
};
type TeamEditorExecutionRuntimeBridgeSummary = {
    schemaId: 'atm.editorExecutionRuntimeBridgeSummary.v1';
    milestone: 'M9I';
    providerIds: readonly ['claude-code', 'gemini'];
    sharedProviderInterface: 'atm.teamProviderContract.v1';
    sharedArtifactType: 'atm.teamProviderRunArtifact.v1';
    roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1';
    observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1';
    coordinatorOwnedAuthority: true;
    brokerConflictVocabulary: readonly ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'];
    bridges: readonly [
        ReturnType<typeof buildClaudeCodeTeamProviderBridgeDescriptor>,
        ReturnType<typeof buildGeminiTeamProviderBridgeDescriptor>
    ];
};
type TeamMicrosoftFoundryRuntimeBridgeSummary = {
    schemaId: 'atm.microsoftFoundryRuntimeBridgeSummary.v1';
    milestone: 'M9I';
    providerIds: readonly ['microsoft-foundry'];
    sharedProviderInterface: 'atm.teamProviderContract.v1';
    sharedArtifactType: 'atm.teamProviderRunArtifact.v1';
    supportedSurfaces: readonly ['project-chat-inference', 'agent-service'];
    observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1';
    coordinatorOwnedAuthority: true;
    brokerConflictVocabulary: readonly ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'];
    bridges: readonly [
        ReturnType<typeof buildMicrosoftFoundryTeamProviderBridgeDescriptor>
    ];
};
type TeamAnthropicRuntimeBridgeSummary = {
    schemaId: 'atm.anthropicRuntimeBridgeSummary.v1';
    milestone: 'M10X';
    providerIds: readonly ['anthropic'];
    sharedProviderInterface: 'atm.teamProviderContract.v1';
    sharedArtifactType: 'atm.teamProviderRunArtifact.v1';
    observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1';
    coordinatorOwnedAuthority: true;
    brokerConflictVocabulary: readonly ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'];
    bridges: readonly [
        ReturnType<typeof buildAnthropicTeamProviderBridgeDescriptor>
    ];
};
export declare function buildOpenAIFamilyRuntimeBridgeSummary(): TeamOpenAIFamilyRuntimeBridgeSummary;
export declare function buildEditorExecutionRuntimeBridgeSummary(): TeamEditorExecutionRuntimeBridgeSummary;
export declare function buildGeminiDirectRuntimeBridgeSummary(): {
    schemaId: string;
    providerIds: readonly ["gemini-direct"];
    sharedProviderInterface: string;
    sharedArtifactType: string;
    coordinatorOwnedAuthority: boolean;
    bridge: {
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
};
export declare function buildMicrosoftFoundryRuntimeBridgeSummary(): TeamMicrosoftFoundryRuntimeBridgeSummary;
export declare function buildAnthropicRuntimeBridgeSummary(): TeamAnthropicRuntimeBridgeSummary;
export {};

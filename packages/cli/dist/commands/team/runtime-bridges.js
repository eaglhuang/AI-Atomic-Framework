import { buildAnthropicTeamProviderBridgeDescriptor } from '../../../../core/dist/team-runtime/providers/anthropic.js';
import { buildAzureOpenAITeamProviderBridgeDescriptor } from '../../../../core/dist/team-runtime/providers/azure-openai.js';
import { buildClaudeCodeTeamProviderBridgeDescriptor } from '../../../../core/dist/team-runtime/providers/claude-code.js';
import { buildGeminiTeamProviderBridgeDescriptor } from '../../../../core/dist/team-runtime/providers/gemini.js';
import { buildGeminiDirectTeamProviderBridgeDescriptor } from '../../../../core/dist/team-runtime/providers/gemini-direct.js';
import { buildMicrosoftFoundryTeamProviderBridgeDescriptor } from '../../../../core/dist/team-runtime/providers/microsoft-foundry.js';
import { buildOpenAITeamProviderBridgeDescriptor } from '../../../../core/dist/team-runtime/providers/openai.js';
export function buildOpenAIFamilyRuntimeBridgeSummary() {
    return {
        schemaId: 'atm.openAIFamilyRuntimeBridgeSummary.v1',
        milestone: 'M9I',
        providerIds: ['openai', 'azure-openai'],
        sharedProviderInterface: 'atm.teamProviderContract.v1',
        sharedArtifactType: 'atm.teamProviderRunArtifact.v1',
        observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
        coordinatorOwnedAuthority: true,
        brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        bridges: [
            buildOpenAITeamProviderBridgeDescriptor(),
            buildAzureOpenAITeamProviderBridgeDescriptor()
        ]
    };
}
export function buildEditorExecutionRuntimeBridgeSummary() {
    return {
        schemaId: 'atm.editorExecutionRuntimeBridgeSummary.v1',
        milestone: 'M9I',
        providerIds: ['claude-code', 'gemini'],
        sharedProviderInterface: 'atm.teamProviderContract.v1',
        sharedArtifactType: 'atm.teamProviderRunArtifact.v1',
        roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1',
        observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
        coordinatorOwnedAuthority: true,
        brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        bridges: [
            buildClaudeCodeTeamProviderBridgeDescriptor(),
            buildGeminiTeamProviderBridgeDescriptor()
        ]
    };
}
export function buildGeminiDirectRuntimeBridgeSummary() {
    return {
        schemaId: 'atm.geminiDirectRuntimeBridgeSummary.v1',
        providerIds: ['gemini-direct'],
        sharedProviderInterface: 'atm.teamProviderContract.v1',
        sharedArtifactType: 'atm.teamProviderRunArtifact.v1',
        coordinatorOwnedAuthority: true,
        bridge: buildGeminiDirectTeamProviderBridgeDescriptor()
    };
}
export function buildMicrosoftFoundryRuntimeBridgeSummary() {
    return {
        schemaId: 'atm.microsoftFoundryRuntimeBridgeSummary.v1',
        milestone: 'M9I',
        providerIds: ['microsoft-foundry'],
        sharedProviderInterface: 'atm.teamProviderContract.v1',
        sharedArtifactType: 'atm.teamProviderRunArtifact.v1',
        supportedSurfaces: ['project-chat-inference', 'agent-service'],
        observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
        coordinatorOwnedAuthority: true,
        brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        bridges: [
            buildMicrosoftFoundryTeamProviderBridgeDescriptor()
        ]
    };
}
export function buildAnthropicRuntimeBridgeSummary() {
    return {
        schemaId: 'atm.anthropicRuntimeBridgeSummary.v1',
        milestone: 'M10X',
        providerIds: ['anthropic'],
        sharedProviderInterface: 'atm.teamProviderContract.v1',
        sharedArtifactType: 'atm.teamProviderRunArtifact.v1',
        observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
        coordinatorOwnedAuthority: true,
        brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        bridges: [
            buildAnthropicTeamProviderBridgeDescriptor()
        ]
    };
}

import { buildAnthropicTeamProviderBridgeDescriptor } from '../../../../core/src/team-runtime/providers/anthropic.ts';
import { buildAzureOpenAITeamProviderBridgeDescriptor } from '../../../../core/src/team-runtime/providers/azure-openai.ts';
import { buildClaudeCodeTeamProviderBridgeDescriptor } from '../../../../core/src/team-runtime/providers/claude-code.ts';
import { buildGeminiTeamProviderBridgeDescriptor } from '../../../../core/src/team-runtime/providers/gemini.ts';
import { buildGeminiDirectTeamProviderBridgeDescriptor } from '../../../../core/src/team-runtime/providers/gemini-direct.ts';
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

export function buildOpenAIFamilyRuntimeBridgeSummary(): TeamOpenAIFamilyRuntimeBridgeSummary {
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

export function buildEditorExecutionRuntimeBridgeSummary(): TeamEditorExecutionRuntimeBridgeSummary {
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
    providerIds: ['gemini-direct'] as const,
    sharedProviderInterface: 'atm.teamProviderContract.v1',
    sharedArtifactType: 'atm.teamProviderRunArtifact.v1',
    coordinatorOwnedAuthority: true,
    bridge: buildGeminiDirectTeamProviderBridgeDescriptor()
  };
}

export function buildMicrosoftFoundryRuntimeBridgeSummary(): TeamMicrosoftFoundryRuntimeBridgeSummary {
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

export function buildAnthropicRuntimeBridgeSummary(): TeamAnthropicRuntimeBridgeSummary {
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

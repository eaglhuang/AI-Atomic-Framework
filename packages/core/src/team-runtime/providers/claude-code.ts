import { decideTeamPermission, type TeamPermissionPolicy } from '../permission-broker.ts';
import { createTeamObservabilityEvent, type TeamObservabilityEvent } from '../observability.ts';
import {
  type TeamProviderContract,
  type TeamProviderId,
  type TeamProviderMetadata,
  type TeamProviderSessionRequest
} from '../provider-contract.ts';

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
  readonly configValidation: ClaudeCodeTeamProviderConfigValidation;
  readonly secretRefFields: readonly string[];
  readonly executionSurface: 'editor-subagent';
};

const CLAUDE_CODE_REQUIRED_FIELDS = ['modelId', 'editorCommand', 'roleEnvelopeSchemaId'] as const;

export function validateClaudeCodeTeamProviderConfig(
  config: Partial<ClaudeCodeTeamProviderConfig>
): ClaudeCodeTeamProviderConfigValidation {
  const missingFields = CLAUDE_CODE_REQUIRED_FIELDS.filter((field) => !normalizeString(config[field]));
  return {
    schemaId: 'atm.claudeCodeTeamProviderConfigValidation.v1',
    providerId: 'claude-code',
    ok: missingFields.length === 0 && config.roleEnvelopeSchemaId === 'atm.teamEditorSubagentRoleEnvelope.v1',
    missingFields: config.roleEnvelopeSchemaId && config.roleEnvelopeSchemaId !== 'atm.teamEditorSubagentRoleEnvelope.v1'
      ? uniqueStrings([...missingFields, 'roleEnvelopeSchemaId'])
      : missingFields,
    requiredFields: CLAUDE_CODE_REQUIRED_FIELDS,
    secretRefFields: [],
    rawSecretsLogged: false
  };
}

export function createClaudeCodeTeamProviderBridge(
  config: ClaudeCodeTeamProviderConfig
): ClaudeCodeTeamProviderBridge {
  const configValidation = validateClaudeCodeTeamProviderConfig(config);
  const metadata: TeamProviderMetadata = {
    providerId: 'claude-code',
    displayName: 'Claude Code editor-subagent Team runtime bridge',
    supportedRuntimeModes: ['editor-subagent', 'broker-only'],
    supportedArtifacts: ['agent-report', 'evidence-summary', 'atm.teamProviderRunArtifact.v1'],
    vendorNeutral: true
  };

  return {
    schemaId: 'atm.teamProviderContract.v1',
    bridgeSchemaId: 'atm.claudeCodeTeamProviderBridge.v1',
    metadata,
    configValidation,
    secretRefFields: [],
    executionSurface: 'editor-subagent',
    sessionLifecycle: {
      createSession: true,
      closeSession: true,
      cancelSession: true,
      retryStep: true
    },
    openSession(request) {
      assertEditorExecutionRequest(request, 'claude-code');
      if (!configValidation.ok) {
        throw new Error(`Claude Code Team provider config is missing: ${configValidation.missingFields.join(', ')}`);
      }
      return {
        sessionId: stableSessionId(request.taskId, request.role, 'claude-code', config.modelId),
        providerId: 'claude-code'
      };
    },
    closeSession(sessionId) {
      return { closed: true, sessionId };
    },
    cancelSession(sessionId, reason) {
      return { cancelled: true, sessionId, reason };
    }
  };
}

export function launchClaudeCodeTeamProviderRun(input: {
  readonly bridge: ClaudeCodeTeamProviderBridge;
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'editor-subagent'; readonly providerId: 'claude-code' };
  readonly permissionPolicy: TeamPermissionPolicy;
  readonly scopedPaths: readonly string[];
  readonly permissionLeases?: readonly string[];
  readonly emittedAt?: string;
}): TeamExecutionBridgeRunResult {
  const session = input.bridge.openSession(input.request);
  const permissionDecision = decideTeamPermission(input.permissionPolicy, {
    permission: 'exec.validator',
    providerId: input.request.providerId,
    scopedPaths: input.scopedPaths
  });
  const artifact = createTeamExecutionBridgeRunArtifact({
    request: input.request,
    sessionId: session.sessionId,
    executionSurface: input.bridge.executionSurface,
    allowedFiles: input.scopedPaths,
    permissionLeases: input.permissionLeases ?? ['exec.validator'],
    permissionDecision,
    secretRefFields: input.bridge.secretRefFields
  });
  const observabilityEvents = createTeamExecutionBridgeObservabilityEvents({
    request: input.request,
    artifact,
    emittedAt: input.emittedAt
  });
  input.bridge.closeSession(session.sessionId);

  return {
    schemaId: 'atm.teamProviderBridgeRunResult.v1',
    ok: permissionDecision.ok,
    providerId: 'claude-code',
    sessionId: session.sessionId,
    artifact: {
      ...artifact,
      observabilityEventCount: observabilityEvents.length
    },
    observabilityEvents
  };
}

export function buildClaudeCodeTeamProviderBridgeDescriptor() {
  return {
    schemaId: 'atm.teamProviderBridgeDescriptor.v1',
    providerId: 'claude-code',
    bridgeSchemaId: 'atm.claudeCodeTeamProviderBridge.v1',
    configSchemaId: 'atm.claudeCodeTeamProviderConfig.v1',
    roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1',
    executionSurface: 'editor-subagent' as const,
    supportedRuntimeModes: ['editor-subagent', 'broker-only'] as const,
    requiredConfigRefs: CLAUDE_CODE_REQUIRED_FIELDS,
    authModes: ['editor-session'] as const,
    brokerCheckedPermissions: ['exec.validator'] as const,
    artifactType: 'atm.teamProviderRunArtifact.v1',
    observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'] as const,
    sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'] as const,
    rawSecretsLogged: false as const
  };
}

export function createTeamExecutionBridgeRunArtifact(input: {
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'editor-subagent' };
  readonly sessionId: string;
  readonly executionSurface: TeamExecutionBridgeSurface;
  readonly allowedFiles: readonly string[];
  readonly permissionLeases: readonly string[];
  readonly permissionDecision: { readonly ok: boolean; readonly permission: string; readonly reason: string };
  readonly secretRefFields: readonly string[];
}): TeamExecutionBridgeRunArtifact {
  return {
    schemaId: 'atm.teamProviderRunArtifact.v1',
    specVersion: '0.1.0',
    artifactType: 'atm.teamProviderRunArtifact.v1',
    taskId: input.request.taskId,
    role: input.request.role,
    providerId: input.request.providerId,
    sdkId: input.request.sdkId,
    modelId: input.request.modelId,
    runtimeMode: 'editor-subagent',
    sessionId: input.sessionId,
    roleEnvelope: createTeamEditorSubagentRoleEnvelope({
      request: input.request,
      executionSurface: input.executionSurface,
      allowedFiles: input.allowedFiles,
      permissionLeases: input.permissionLeases
    }),
    permissionDecision: input.permissionDecision,
    outputArtifacts: ['agent-report', 'evidence-summary'],
    observabilityEventCount: 0,
    redaction: {
      rawSecretsLogged: false,
      secretRefFields: input.secretRefFields
    }
  };
}

export function createTeamExecutionBridgeObservabilityEvents(input: {
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'editor-subagent' };
  readonly artifact: TeamExecutionBridgeRunArtifact;
  readonly emittedAt?: string;
}): TeamObservabilityEvent[] {
  const common = {
    taskId: input.request.taskId,
    teamRunId: input.artifact.sessionId,
    providerId: input.request.providerId,
    role: input.request.role,
    runtimeMode: 'editor-subagent' as const,
    emittedAt: input.emittedAt
  };
  return [
    createTeamObservabilityEvent({
      ...common,
      eventType: 'session.start',
      summary: `${input.request.providerId} editor-subagent session opened through the shared Team provider contract.`
    }),
    createTeamObservabilityEvent({
      ...common,
      eventType: 'artifact.output',
      artifactType: input.artifact.artifactType,
      artifactId: input.artifact.sessionId,
      summary: `${input.request.providerId} emitted the shared Team provider run artifact.`
    }),
    createTeamObservabilityEvent({
      ...common,
      eventType: 'session.complete',
      summary: `${input.request.providerId} editor-subagent session closed under coordinator-owned authority.`
    })
  ];
}

function createTeamEditorSubagentRoleEnvelope(input: {
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'editor-subagent' };
  readonly executionSurface: TeamExecutionBridgeSurface;
  readonly allowedFiles: readonly string[];
  readonly permissionLeases: readonly string[];
}): TeamEditorSubagentRoleEnvelope {
  return {
    schemaId: 'atm.teamEditorSubagentRoleEnvelope.v1',
    taskId: input.request.taskId,
    role: input.request.role,
    providerId: input.request.providerId,
    sdkId: input.request.sdkId,
    modelId: input.request.modelId,
    runtimeMode: 'editor-subagent',
    executionSurface: input.executionSurface,
    allowedFiles: input.allowedFiles,
    permissionLeases: input.permissionLeases,
    coordinatorOwnedAuthority: true,
    brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked']
  };
}

export function assertEditorExecutionRequest(request: TeamProviderSessionRequest, providerId: TeamProviderId): void {
  if (request.providerId !== providerId) {
    throw new Error(`Expected providerId ${providerId}; received ${request.providerId}.`);
  }
  if (request.runtimeMode !== 'editor-subagent') {
    throw new Error(`${providerId} bridge requires runtimeMode editor-subagent for editor execution bridges.`);
  }
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function stableSessionId(taskId: string, role: string, providerId: TeamProviderId, modelId: string): string {
  return `team-provider:${taskId}:${role}:${providerId}:${modelId}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

import { decideTeamPermission, type TeamPermissionPolicy } from '../permission-broker.ts';
import {
  assertEditorExecutionRequest,
  createTeamExecutionBridgeObservabilityEvents,
  createTeamExecutionBridgeRunArtifact,
  type TeamExecutionBridgeRunResult
} from './claude-code.ts';
import {
  type TeamProviderContract,
  type TeamProviderMetadata,
  type TeamProviderSessionRequest
} from '../provider-contract.ts';

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
  readonly configValidation: GeminiTeamProviderConfigValidation;
  readonly secretRefFields: readonly string[];
  readonly executionSurface: 'cli-style';
};

const GEMINI_REQUIRED_FIELDS = ['modelId', 'cliCommand', 'roleEnvelopeSchemaId'] as const;

export function validateGeminiTeamProviderConfig(
  config: Partial<GeminiTeamProviderConfig>
): GeminiTeamProviderConfigValidation {
  const missingFields = GEMINI_REQUIRED_FIELDS.filter((field) => !normalizeString(config[field]));
  return {
    schemaId: 'atm.geminiTeamProviderConfigValidation.v1',
    providerId: 'gemini',
    ok: missingFields.length === 0 && config.roleEnvelopeSchemaId === 'atm.teamEditorSubagentRoleEnvelope.v1',
    missingFields: config.roleEnvelopeSchemaId && config.roleEnvelopeSchemaId !== 'atm.teamEditorSubagentRoleEnvelope.v1'
      ? uniqueStrings([...missingFields, 'roleEnvelopeSchemaId'])
      : missingFields,
    requiredFields: GEMINI_REQUIRED_FIELDS,
    secretRefFields: [],
    rawSecretsLogged: false
  };
}

export function createGeminiTeamProviderBridge(config: GeminiTeamProviderConfig): GeminiTeamProviderBridge {
  const configValidation = validateGeminiTeamProviderConfig(config);
  const metadata: TeamProviderMetadata = {
    providerId: 'gemini',
    displayName: 'Gemini CLI-style Team runtime bridge',
    supportedRuntimeModes: ['editor-subagent', 'broker-only'],
    supportedArtifacts: ['agent-report', 'evidence-summary', 'atm.teamProviderRunArtifact.v1'],
    vendorNeutral: true
  };

  return {
    schemaId: 'atm.teamProviderContract.v1',
    bridgeSchemaId: 'atm.geminiTeamProviderBridge.v1',
    metadata,
    configValidation,
    secretRefFields: [],
    executionSurface: 'cli-style',
    sessionLifecycle: {
      createSession: true,
      closeSession: true,
      cancelSession: true,
      retryStep: true
    },
    openSession(request) {
      assertEditorExecutionRequest(request, 'gemini');
      if (!configValidation.ok) {
        throw new Error(`Gemini Team provider config is missing: ${configValidation.missingFields.join(', ')}`);
      }
      return {
        sessionId: `team-provider:${request.taskId}:${request.role}:gemini:${config.modelId}`,
        providerId: 'gemini'
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

export function launchGeminiTeamProviderRun(input: {
  readonly bridge: GeminiTeamProviderBridge;
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'editor-subagent'; readonly providerId: 'gemini' };
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
    providerId: 'gemini',
    sessionId: session.sessionId,
    artifact: {
      ...artifact,
      observabilityEventCount: observabilityEvents.length
    },
    observabilityEvents
  };
}

export function buildGeminiTeamProviderBridgeDescriptor() {
  return {
    schemaId: 'atm.teamProviderBridgeDescriptor.v1',
    providerId: 'gemini',
    bridgeSchemaId: 'atm.geminiTeamProviderBridge.v1',
    configSchemaId: 'atm.geminiTeamProviderConfig.v1',
    roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1',
    executionSurface: 'cli-style' as const,
    supportedRuntimeModes: ['editor-subagent', 'broker-only'] as const,
    requiredConfigRefs: GEMINI_REQUIRED_FIELDS,
    authModes: ['cli-auth'] as const,
    brokerCheckedPermissions: ['exec.validator'] as const,
    artifactType: 'atm.teamProviderRunArtifact.v1',
    observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'] as const,
    sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'] as const,
    rawSecretsLogged: false as const
  };
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

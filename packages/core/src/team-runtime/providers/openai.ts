import { decideTeamPermission, type TeamPermissionPolicy } from '../permission-broker.ts';
import { createTeamObservabilityEvent, type TeamObservabilityEvent } from '../observability.ts';
import {
  type TeamProviderContract,
  type TeamProviderId,
  type TeamProviderMetadata,
  type TeamProviderSessionRequest
} from '../provider-contract.ts';

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
  readonly configValidation: OpenAITeamProviderConfigValidation;
  readonly secretRefFields: readonly string[];
};

const OPENAI_REQUIRED_FIELDS = ['modelId', 'apiKeyEnvVar'] as const;
const OPENAI_OPTIONAL_FIELDS = ['baseUrlEnvVar', 'organizationEnvVar', 'projectEnvVar'] as const;

export function validateOpenAITeamProviderConfig(
  config: Partial<OpenAITeamProviderConfig>
): OpenAITeamProviderConfigValidation {
  const missingFields = OPENAI_REQUIRED_FIELDS.filter((field) => !normalizeString(config[field]));
  return {
    schemaId: 'atm.openaiTeamProviderConfigValidation.v1',
    providerId: 'openai',
    ok: missingFields.length === 0,
    missingFields,
    requiredFields: OPENAI_REQUIRED_FIELDS,
    optionalFields: OPENAI_OPTIONAL_FIELDS,
    secretRefFields: ['apiKeyEnvVar'],
    rawSecretsLogged: false
  };
}

export function createOpenAITeamProviderBridge(config: OpenAITeamProviderConfig): OpenAITeamProviderBridge {
  const configValidation = validateOpenAITeamProviderConfig(config);
  const metadata: TeamProviderMetadata = {
    providerId: 'openai',
    displayName: 'OpenAI direct Team runtime bridge',
    supportedRuntimeModes: ['real-agent', 'broker-only'],
    supportedArtifacts: ['agent-report', 'evidence-summary', 'atm.teamProviderRunArtifact.v1'],
    vendorNeutral: true
  };

  return {
    schemaId: 'atm.teamProviderContract.v1',
    bridgeSchemaId: 'atm.openaiTeamProviderBridge.v1',
    metadata,
    configValidation,
    secretRefFields: ['apiKeyEnvVar'],
    sessionLifecycle: {
      createSession: true,
      closeSession: true,
      cancelSession: true,
      retryStep: true
    },
    openSession(request) {
      assertOpenAIRequest(request, 'openai');
      if (!configValidation.ok) {
        throw new Error(`OpenAI Team provider config is missing: ${configValidation.missingFields.join(', ')}`);
      }
      return {
        sessionId: stableSessionId(request.taskId, request.role, 'openai', config.modelId),
        providerId: 'openai'
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

export function launchOpenAITeamProviderRun(input: {
  readonly bridge: OpenAITeamProviderBridge;
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'real-agent' };
  readonly permissionPolicy: TeamPermissionPolicy;
  readonly scopedPaths: readonly string[];
  readonly emittedAt?: string;
}): OpenAIFamilyBridgeRunResult {
  const session = input.bridge.openSession(input.request);
  const permissionDecision = decideTeamPermission(input.permissionPolicy, {
    permission: 'exec.validator',
    providerId: input.request.providerId,
    scopedPaths: input.scopedPaths
  });
  const artifact = createOpenAIFamilyRunArtifact({
    request: input.request,
    sessionId: session.sessionId,
    permissionDecision,
    secretRefFields: input.bridge.secretRefFields
  });
  const observabilityEvents = createOpenAIFamilyObservabilityEvents({
    request: input.request,
    artifact,
    emittedAt: input.emittedAt
  });
  input.bridge.closeSession(session.sessionId);

  return {
    schemaId: 'atm.teamProviderBridgeRunResult.v1',
    ok: permissionDecision.ok,
    providerId: 'openai',
    sessionId: session.sessionId,
    artifact: {
      ...artifact,
      observabilityEventCount: observabilityEvents.length
    },
    observabilityEvents
  };
}

export function buildOpenAITeamProviderBridgeDescriptor() {
  return {
    schemaId: 'atm.teamProviderBridgeDescriptor.v1',
    providerId: 'openai',
    bridgeSchemaId: 'atm.openaiTeamProviderBridge.v1',
    configSchemaId: 'atm.openaiTeamProviderConfig.v1',
    supportedRuntimeModes: ['real-agent', 'broker-only'] as const,
    requiredConfigRefs: OPENAI_REQUIRED_FIELDS,
    optionalConfigRefs: OPENAI_OPTIONAL_FIELDS,
    authModes: ['api-key-env'] as const,
    brokerCheckedPermissions: ['exec.validator'] as const,
    artifactType: 'atm.teamProviderRunArtifact.v1',
    observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'] as const,
    sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'] as const,
    rawSecretsLogged: false as const
  };
}

export function createOpenAIFamilyRunArtifact(input: {
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'real-agent' };
  readonly sessionId: string;
  readonly permissionDecision: { readonly ok: boolean; readonly permission: string; readonly reason: string };
  readonly secretRefFields: readonly string[];
}): OpenAIFamilyRunArtifact {
  return {
    schemaId: 'atm.teamProviderRunArtifact.v1',
    specVersion: '0.1.0',
    artifactType: 'atm.teamProviderRunArtifact.v1',
    taskId: input.request.taskId,
    role: input.request.role,
    providerId: input.request.providerId,
    sdkId: input.request.sdkId,
    modelId: input.request.modelId,
    runtimeMode: 'real-agent',
    sessionId: input.sessionId,
    permissionDecision: input.permissionDecision,
    outputArtifacts: ['agent-report', 'evidence-summary'],
    observabilityEventCount: 0,
    redaction: {
      rawSecretsLogged: false,
      secretRefFields: input.secretRefFields
    }
  };
}

export function createOpenAIFamilyObservabilityEvents(input: {
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'real-agent' };
  readonly artifact: OpenAIFamilyRunArtifact;
  readonly emittedAt?: string;
}): TeamObservabilityEvent[] {
  const common = {
    taskId: input.request.taskId,
    teamRunId: input.artifact.sessionId,
    providerId: input.request.providerId,
    role: input.request.role,
    runtimeMode: 'real-agent' as const,
    emittedAt: input.emittedAt
  };
  return [
    createTeamObservabilityEvent({
      ...common,
      eventType: 'session.start',
      summary: `${input.request.providerId} real-agent session opened through the shared Team provider contract.`
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
      summary: `${input.request.providerId} real-agent session closed under coordinator-owned authority.`
    })
  ];
}

function assertOpenAIRequest(request: TeamProviderSessionRequest, providerId: TeamProviderId): void {
  if (request.providerId !== providerId) {
    throw new Error(`Expected providerId ${providerId}; received ${request.providerId}.`);
  }
  if (request.runtimeMode !== 'real-agent') {
    throw new Error(`${providerId} bridge requires runtimeMode real-agent for direct provider runs.`);
  }
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function stableSessionId(taskId: string, role: string, providerId: TeamProviderId, modelId: string): string {
  return `team-provider:${taskId}:${role}:${providerId}:${modelId}`;
}

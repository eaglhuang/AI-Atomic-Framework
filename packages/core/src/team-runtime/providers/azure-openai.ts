import { decideTeamPermission, type TeamPermissionPolicy } from '../permission-broker.ts';
import {
  createOpenAIFamilyObservabilityEvents,
  createOpenAIFamilyRunArtifact,
  type OpenAIFamilyBridgeRunResult,
  type OpenAIFamilyRunArtifact
} from './openai.ts';
import {
  type TeamProviderContract,
  type TeamProviderMetadata,
  type TeamProviderSessionRequest
} from '../provider-contract.ts';

export type AzureOpenAIAuthMode = 'api-key-env' | 'managed-identity';

export type AzureOpenAITeamProviderConfig = {
  readonly schemaId: 'atm.azureOpenAITeamProviderConfig.v1';
  readonly providerId: 'azure-openai';
  readonly sdkId: 'azure-openai-responses';
  readonly deploymentName: string;
  readonly endpointEnvVar: string;
  readonly modelId: string;
  readonly authMode: AzureOpenAIAuthMode;
  readonly apiKeyEnvVar?: string | null;
  readonly tenantIdEnvVar?: string | null;
};

export type AzureOpenAITeamProviderConfigValidation = {
  readonly schemaId: 'atm.azureOpenAITeamProviderConfigValidation.v1';
  readonly providerId: 'azure-openai';
  readonly ok: boolean;
  readonly authMode: AzureOpenAIAuthMode | null;
  readonly missingFields: readonly string[];
  readonly requiredFields: readonly string[];
  readonly secretRefFields: readonly string[];
  readonly rawSecretsLogged: false;
};

export type AzureOpenAITeamProviderBridge = TeamProviderContract & {
  readonly bridgeSchemaId: 'atm.azureOpenAITeamProviderBridge.v1';
  readonly configValidation: AzureOpenAITeamProviderConfigValidation;
  readonly secretRefFields: readonly string[];
};

const AZURE_BASE_REQUIRED_FIELDS = ['endpointEnvVar', 'deploymentName', 'modelId', 'authMode'] as const;

export function validateAzureOpenAITeamProviderConfig(
  config: Partial<AzureOpenAITeamProviderConfig>
): AzureOpenAITeamProviderConfigValidation {
  const authMode = normalizeAuthMode(config.authMode);
  const requiredFields = [
    ...AZURE_BASE_REQUIRED_FIELDS,
    ...(authMode === 'api-key-env' ? ['apiKeyEnvVar'] as const : []),
    ...(authMode === 'managed-identity' ? ['tenantIdEnvVar'] as const : [])
  ];
  const missingFields = requiredFields.filter((field) => !normalizeString(config[field]));
  return {
    schemaId: 'atm.azureOpenAITeamProviderConfigValidation.v1',
    providerId: 'azure-openai',
    ok: missingFields.length === 0 && authMode !== null,
    authMode,
    missingFields: authMode === null ? uniqueStrings([...missingFields, 'authMode']) : missingFields,
    requiredFields,
    secretRefFields: authMode === 'api-key-env' ? ['apiKeyEnvVar'] : [],
    rawSecretsLogged: false
  };
}

export function createAzureOpenAITeamProviderBridge(
  config: AzureOpenAITeamProviderConfig
): AzureOpenAITeamProviderBridge {
  const configValidation = validateAzureOpenAITeamProviderConfig(config);
  const metadata: TeamProviderMetadata = {
    providerId: 'azure-openai',
    displayName: 'Azure OpenAI direct Team runtime bridge',
    supportedRuntimeModes: ['real-agent', 'broker-only'],
    supportedArtifacts: ['agent-report', 'evidence-summary', 'atm.teamProviderRunArtifact.v1'],
    vendorNeutral: true
  };

  return {
    schemaId: 'atm.teamProviderContract.v1',
    bridgeSchemaId: 'atm.azureOpenAITeamProviderBridge.v1',
    metadata,
    configValidation,
    secretRefFields: configValidation.secretRefFields,
    sessionLifecycle: {
      createSession: true,
      closeSession: true,
      cancelSession: true,
      retryStep: true
    },
    openSession(request) {
      assertAzureOpenAIRequest(request);
      if (!configValidation.ok) {
        throw new Error(`Azure OpenAI Team provider config is missing: ${configValidation.missingFields.join(', ')}`);
      }
      return {
        sessionId: `team-provider:${request.taskId}:${request.role}:azure-openai:${config.deploymentName}`,
        providerId: 'azure-openai'
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

export function launchAzureOpenAITeamProviderRun(input: {
  readonly bridge: AzureOpenAITeamProviderBridge;
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'real-agent'; readonly providerId: 'azure-openai' };
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
  }) as OpenAIFamilyRunArtifact;
  const observabilityEvents = createOpenAIFamilyObservabilityEvents({
    request: input.request,
    artifact,
    emittedAt: input.emittedAt
  });
  input.bridge.closeSession(session.sessionId);

  return {
    schemaId: 'atm.teamProviderBridgeRunResult.v1',
    ok: permissionDecision.ok,
    providerId: 'azure-openai',
    sessionId: session.sessionId,
    artifact: {
      ...artifact,
      observabilityEventCount: observabilityEvents.length
    },
    observabilityEvents
  };
}

export function buildAzureOpenAITeamProviderBridgeDescriptor() {
  return {
    schemaId: 'atm.teamProviderBridgeDescriptor.v1',
    providerId: 'azure-openai',
    bridgeSchemaId: 'atm.azureOpenAITeamProviderBridge.v1',
    configSchemaId: 'atm.azureOpenAITeamProviderConfig.v1',
    supportedRuntimeModes: ['real-agent', 'broker-only'] as const,
    requiredConfigRefs: AZURE_BASE_REQUIRED_FIELDS,
    authModes: ['api-key-env', 'managed-identity'] as const,
    brokerCheckedPermissions: ['exec.validator'] as const,
    artifactType: 'atm.teamProviderRunArtifact.v1',
    observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'] as const,
    sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'] as const,
    rawSecretsLogged: false as const
  };
}

function assertAzureOpenAIRequest(request: TeamProviderSessionRequest): void {
  if (request.providerId !== 'azure-openai') {
    throw new Error(`Expected providerId azure-openai; received ${request.providerId}.`);
  }
  if (request.runtimeMode !== 'real-agent') {
    throw new Error('azure-openai bridge requires runtimeMode real-agent for direct provider runs.');
  }
}

function normalizeAuthMode(value: unknown): AzureOpenAIAuthMode | null {
  const normalized = normalizeString(value);
  return normalized === 'api-key-env' || normalized === 'managed-identity' ? normalized : null;
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

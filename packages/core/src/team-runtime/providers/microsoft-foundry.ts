import { decideTeamPermission, type TeamPermissionPolicy } from '../permission-broker.ts';
import {
  createOpenAIFamilyObservabilityEvents,
  createOpenAIFamilyRunArtifact,
  missingSecretResult,
  normalizeBaseUrl,
  normalizeHttpExecutionResult,
  type OpenAIFamilyBridgeRunResult,
  type OpenAIFamilyRunArtifact
} from './openai.ts';
import {
  type TeamProviderContract,
  type TeamProviderExecutionResult,
  type TeamProviderHttpExecutor,
  type TeamProviderMetadata,
  type TeamProviderSessionRequest
} from '../provider-contract.ts';

export type MicrosoftFoundrySurface = 'project-chat-inference' | 'agent-service';

export type MicrosoftFoundryBaseConfig = {
  readonly schemaId: 'atm.microsoftFoundryTeamProviderConfig.v1';
  readonly providerId: 'microsoft-foundry';
  readonly sdkId: 'microsoft-foundry';
  readonly surface: MicrosoftFoundrySurface;
  readonly modelId: string;
  readonly projectEndpointEnvVar: string;
  readonly tenantIdEnvVar?: string | null;
};

export type MicrosoftFoundryChatInferenceConfig = MicrosoftFoundryBaseConfig & {
  readonly surface: 'project-chat-inference';
  readonly deploymentName: string;
};

export type MicrosoftFoundryAgentServiceConfig = MicrosoftFoundryBaseConfig & {
  readonly surface: 'agent-service';
  readonly agentIdEnvVar: string;
};

export type MicrosoftFoundryTeamProviderConfig =
  | MicrosoftFoundryChatInferenceConfig
  | MicrosoftFoundryAgentServiceConfig;

export type MicrosoftFoundryTeamProviderConfigValidation = {
  readonly schemaId: 'atm.microsoftFoundryTeamProviderConfigValidation.v1';
  readonly providerId: 'microsoft-foundry';
  readonly ok: boolean;
  readonly surface: MicrosoftFoundrySurface | null;
  readonly missingFields: readonly string[];
  readonly requiredFields: readonly string[];
  readonly secretRefFields: readonly string[];
  readonly rawSecretsLogged: false;
};

export type MicrosoftFoundryTeamProviderBridge = TeamProviderContract & {
  readonly bridgeSchemaId: 'atm.microsoftFoundryTeamProviderBridge.v1';
  readonly config: MicrosoftFoundryTeamProviderConfig;
  readonly configValidation: MicrosoftFoundryTeamProviderConfigValidation;
  readonly secretRefFields: readonly string[];
  readonly surface: MicrosoftFoundrySurface;
};

export type MicrosoftFoundryRunArtifact = OpenAIFamilyRunArtifact & {
  readonly providerId: 'microsoft-foundry';
  readonly foundrySurface: MicrosoftFoundrySurface;
  readonly foundryConfigRefs: {
    readonly projectEndpointEnvVar: string;
    readonly deploymentName?: string;
    readonly agentIdEnvVar?: string;
    readonly tenantIdEnvVar?: string | null;
  };
};

export type MicrosoftFoundryBridgeRunResult = Omit<OpenAIFamilyBridgeRunResult, 'providerId' | 'artifact'> & {
  readonly providerId: 'microsoft-foundry';
  readonly artifact: MicrosoftFoundryRunArtifact;
};

const FOUNDRY_BASE_REQUIRED_FIELDS = ['surface', 'modelId', 'projectEndpointEnvVar'] as const;
const FOUNDRY_CHAT_REQUIRED_FIELDS = ['deploymentName'] as const;
const FOUNDRY_AGENT_REQUIRED_FIELDS = ['agentIdEnvVar'] as const;

export function validateMicrosoftFoundryTeamProviderConfig(
  config: Partial<MicrosoftFoundryTeamProviderConfig>
): MicrosoftFoundryTeamProviderConfigValidation {
  const surface = normalizeSurface(config.surface);
  const requiredFields = [
    ...FOUNDRY_BASE_REQUIRED_FIELDS,
    ...(surface === 'project-chat-inference' ? FOUNDRY_CHAT_REQUIRED_FIELDS : []),
    ...(surface === 'agent-service' ? FOUNDRY_AGENT_REQUIRED_FIELDS : [])
  ];
  const missingFields = requiredFields.filter((field) => !normalizeString(readConfigField(config, field)));
  return {
    schemaId: 'atm.microsoftFoundryTeamProviderConfigValidation.v1',
    providerId: 'microsoft-foundry',
    ok: missingFields.length === 0 && surface !== null,
    surface,
    missingFields: surface === null ? uniqueStrings([...missingFields, 'surface']) : missingFields,
    requiredFields,
    secretRefFields: [],
    rawSecretsLogged: false
  };
}

export function createMicrosoftFoundryTeamProviderBridge(
  config: MicrosoftFoundryTeamProviderConfig
): MicrosoftFoundryTeamProviderBridge {
  const configValidation = validateMicrosoftFoundryTeamProviderConfig(config);
  const metadata: TeamProviderMetadata = {
    providerId: 'microsoft-foundry',
    displayName: 'Microsoft Foundry provider-family Team runtime bridge',
    supportedRuntimeModes: ['real-agent', 'broker-only'],
    supportedArtifacts: ['agent-report', 'evidence-summary', 'atm.teamProviderRunArtifact.v1'],
    vendorNeutral: true
  };

  return {
    schemaId: 'atm.teamProviderContract.v1',
    bridgeSchemaId: 'atm.microsoftFoundryTeamProviderBridge.v1',
    config,
    metadata,
    configValidation,
    secretRefFields: [],
    surface: config.surface,
    sessionLifecycle: {
      createSession: true,
      closeSession: true,
      cancelSession: true,
      retryStep: true
    },
    openSession(request) {
      assertMicrosoftFoundryRequest(request);
      if (!configValidation.ok) {
        throw new Error(`Microsoft Foundry Team provider config is missing: ${configValidation.missingFields.join(', ')}`);
      }
      return {
        sessionId: `team-provider:${request.taskId}:${request.role}:microsoft-foundry:${config.surface}:${config.modelId}`,
        providerId: 'microsoft-foundry'
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

export async function launchMicrosoftFoundryTeamProviderRun(input: {
  readonly bridge: MicrosoftFoundryTeamProviderBridge;
  readonly config: MicrosoftFoundryTeamProviderConfig;
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'real-agent'; readonly providerId: 'microsoft-foundry' };
  readonly permissionPolicy: TeamPermissionPolicy;
  readonly scopedPaths: readonly string[];
  readonly executor?: TeamProviderHttpExecutor;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
  readonly emittedAt?: string;
}): Promise<MicrosoftFoundryBridgeRunResult> {
  const session = input.bridge.openSession(input.request);
  const permissionDecision = decideTeamPermission(input.permissionPolicy, {
    permission: 'exec.validator',
    providerId: input.request.providerId,
    scopedPaths: input.scopedPaths
  });
  const execution = permissionDecision.ok
    ? await executeMicrosoftFoundryProvider({
      config: input.config,
      request: input.request,
      sessionId: session.sessionId,
      scopedPaths: input.scopedPaths,
      executor: input.executor,
      env: input.env,
      timeoutMs: input.timeoutMs
    })
    : {
      ok: false,
      outputText: '',
      retryable: false,
      summary: 'Execution blocked by Team permission broker.',
      executionMode: 'vendor-api' as const
    };
  const artifact = createMicrosoftFoundryRunArtifact({
    request: input.request,
    config: input.config,
    sessionId: session.sessionId,
    permissionDecision,
    secretRefFields: input.bridge.secretRefFields,
    execution
  });
  const observabilityEvents = createOpenAIFamilyObservabilityEvents({
    request: input.request,
    artifact,
    emittedAt: input.emittedAt
  });
  input.bridge.closeSession(session.sessionId);

  return {
    schemaId: 'atm.teamProviderBridgeRunResult.v1',
    ok: permissionDecision.ok && execution.ok,
    providerId: 'microsoft-foundry',
    sessionId: session.sessionId,
    artifact: {
      ...artifact,
      observabilityEventCount: observabilityEvents.length
    },
    observabilityEvents
  };
}

export async function executeMicrosoftFoundryProvider(input: {
  readonly config: MicrosoftFoundryTeamProviderConfig;
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'real-agent'; readonly providerId: 'microsoft-foundry' };
  readonly sessionId: string;
  readonly scopedPaths: readonly string[];
  readonly executor?: TeamProviderHttpExecutor;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult> {
  const env = input.env ?? process.env;
  const endpoint = env[input.config.projectEndpointEnvVar];
  if (!endpoint) return missingSecretResult(input.config.projectEndpointEnvVar, 'Microsoft Foundry project endpoint');
  const token = env.AZURE_AI_FOUNDRY_BEARER_TOKEN ?? env.AZURE_ACCESS_TOKEN;
  if (!token) return missingSecretResult('AZURE_AI_FOUNDRY_BEARER_TOKEN', 'Microsoft Foundry bearer token');
  const apiVersion = env.AZURE_AI_FOUNDRY_API_VERSION ?? '2025-05-01-preview';
  const url = input.config.surface === 'project-chat-inference'
    ? `${normalizeBaseUrl(endpoint, endpoint)}/openai/deployments/${encodeURIComponent(input.config.deploymentName)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`
    : `${normalizeBaseUrl(endpoint, endpoint)}/assistants/${encodeURIComponent(env[input.config.agentIdEnvVar] ?? input.config.agentIdEnvVar)}/messages?api-version=${encodeURIComponent(apiVersion)}`;
  const body = input.config.surface === 'project-chat-inference'
    ? {
      model: input.config.modelId,
      messages: [
        { role: 'system', content: input.request.instructions ?? `Run Team role ${input.request.role} under ATM coordinator authority.` },
        { role: 'user', content: input.request.input ?? `Task ${input.request.taskId}; scoped paths: ${input.scopedPaths.join(', ')}` }
      ]
    }
    : {
      role: input.request.role,
      content: input.request.input ?? input.request.instructions ?? `Run Team role ${input.request.role} for ${input.request.taskId}.`,
      metadata: {
        taskId: input.request.taskId,
        sessionId: input.sessionId,
        scopedPathCount: input.scopedPaths.length
      }
    };
  const result = await (input.executor ?? defaultFoundryHttpExecutor)({
    url,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body,
    timeoutMs: input.timeoutMs
  });
  return normalizeHttpExecutionResult(result, 'Microsoft Foundry API');
}

export function buildMicrosoftFoundryTeamProviderBridgeDescriptor() {
  return {
    schemaId: 'atm.teamProviderBridgeDescriptor.v1',
    providerId: 'microsoft-foundry',
    bridgeSchemaId: 'atm.microsoftFoundryTeamProviderBridge.v1',
    configSchemaId: 'atm.microsoftFoundryTeamProviderConfig.v1',
    supportedSurfaces: ['project-chat-inference', 'agent-service'] as const,
    supportedRuntimeModes: ['real-agent', 'broker-only'] as const,
    requiredConfigRefs: {
      base: FOUNDRY_BASE_REQUIRED_FIELDS,
      projectChatInference: FOUNDRY_CHAT_REQUIRED_FIELDS,
      agentService: FOUNDRY_AGENT_REQUIRED_FIELDS
    },
    authModes: ['project-endpoint-env', 'managed-identity'] as const,
    executionReadiness: 'vendor-execution-ready' as const,
    executionSurface: 'microsoft-foundry-http' as const,
    brokerCheckedPermissions: ['exec.validator'] as const,
    artifactType: 'atm.teamProviderRunArtifact.v1',
    observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'] as const,
    sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'] as const,
    rawSecretsLogged: false as const
  };
}

function createMicrosoftFoundryRunArtifact(input: {
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'real-agent'; readonly providerId: 'microsoft-foundry' };
  readonly config: MicrosoftFoundryTeamProviderConfig;
  readonly sessionId: string;
  readonly permissionDecision: { readonly ok: boolean; readonly permission: string; readonly reason: string };
  readonly secretRefFields: readonly string[];
  readonly execution: TeamProviderExecutionResult;
}): MicrosoftFoundryRunArtifact {
  const baseArtifact = createOpenAIFamilyRunArtifact({
    request: input.request,
    sessionId: input.sessionId,
    permissionDecision: input.permissionDecision,
    secretRefFields: input.secretRefFields,
    execution: input.execution
  }) as OpenAIFamilyRunArtifact & { readonly providerId: 'microsoft-foundry' };
  return {
    ...baseArtifact,
    providerId: 'microsoft-foundry',
    foundrySurface: input.config.surface,
    foundryConfigRefs: {
      projectEndpointEnvVar: input.config.projectEndpointEnvVar,
      deploymentName: input.config.surface === 'project-chat-inference' ? input.config.deploymentName : undefined,
      agentIdEnvVar: input.config.surface === 'agent-service' ? input.config.agentIdEnvVar : undefined,
      tenantIdEnvVar: input.config.tenantIdEnvVar ?? null
    }
  };
}

function assertMicrosoftFoundryRequest(request: TeamProviderSessionRequest): void {
  if (request.providerId !== 'microsoft-foundry') {
    throw new Error(`Expected providerId microsoft-foundry; received ${request.providerId}.`);
  }
  if (request.runtimeMode !== 'real-agent') {
    throw new Error('microsoft-foundry bridge requires runtimeMode real-agent for provider-family runs.');
  }
}

function normalizeSurface(value: unknown): MicrosoftFoundrySurface | null {
  const normalized = normalizeString(value);
  return normalized === 'project-chat-inference' || normalized === 'agent-service' ? normalized : null;
}

function readConfigField(config: Partial<MicrosoftFoundryTeamProviderConfig>, field: string): unknown {
  return (config as Record<string, unknown>)[field];
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

async function defaultFoundryHttpExecutor(input: {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult> {
  const controller = new AbortController();
  const timeout = input.timeoutMs ? setTimeout(() => controller.abort(), input.timeoutMs) : null;
  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      body: JSON.stringify(input.body),
      signal: controller.signal
    });
    const text = await response.text();
    return {
      ok: response.ok,
      statusCode: response.status,
      outputText: text,
      retryable: response.status === 429 || response.status >= 500,
      summary: response.ok ? 'Microsoft Foundry request completed.' : `Microsoft Foundry request failed with HTTP ${response.status}.`,
      executionMode: 'vendor-api'
    };
  } catch (error) {
    return {
      ok: false,
      outputText: error instanceof Error ? error.message : String(error),
      retryable: true,
      summary: 'Microsoft Foundry request failed before a response was returned.',
      executionMode: 'vendor-api'
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

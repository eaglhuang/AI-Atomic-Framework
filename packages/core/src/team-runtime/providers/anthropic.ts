import { decideTeamPermission, type TeamPermissionPolicy } from '../permission-broker.ts';
import {
  type TeamProviderContract,
  type TeamProviderExecutionResult,
  type TeamProviderHttpExecutor,
  type TeamProviderMetadata,
  type TeamProviderSessionRequest
} from '../provider-contract.ts';
import {
  createOpenAIFamilyObservabilityEvents,
  createOpenAIFamilyRunArtifact,
  type OpenAIFamilyBridgeRunResult,
  type OpenAIFamilyRunArtifact
} from './openai.ts';

export type AnthropicTeamProviderConfig = {
  readonly schemaId: 'atm.anthropicTeamProviderConfig.v1';
  readonly providerId: 'anthropic';
  readonly sdkId: 'anthropic-messages';
  readonly modelId: string;
  readonly apiKeyEnvVar: string;
  readonly baseUrlEnvVar?: string | null;
};

export type AnthropicTeamProviderConfigValidation = {
  readonly schemaId: 'atm.anthropicTeamProviderConfigValidation.v1';
  readonly providerId: 'anthropic';
  readonly ok: boolean;
  readonly missingFields: readonly string[];
  readonly requiredFields: readonly string[];
  readonly optionalFields: readonly string[];
  readonly secretRefFields: readonly string[];
  readonly rawSecretsLogged: false;
};

export type AnthropicTeamProviderBridge = TeamProviderContract & {
  readonly bridgeSchemaId: 'atm.anthropicTeamProviderBridge.v1';
  readonly config: AnthropicTeamProviderConfig;
  readonly configValidation: AnthropicTeamProviderConfigValidation;
  readonly secretRefFields: readonly string[];
};

const ANTHROPIC_REQUIRED_FIELDS = ['modelId', 'apiKeyEnvVar'] as const;
const ANTHROPIC_OPTIONAL_FIELDS = ['baseUrlEnvVar'] as const;

export function validateAnthropicTeamProviderConfig(
  config: Partial<AnthropicTeamProviderConfig>
): AnthropicTeamProviderConfigValidation {
  const missingFields = ANTHROPIC_REQUIRED_FIELDS.filter((field) => !normalizeString(config[field]));
  return {
    schemaId: 'atm.anthropicTeamProviderConfigValidation.v1',
    providerId: 'anthropic',
    ok: missingFields.length === 0,
    missingFields,
    requiredFields: ANTHROPIC_REQUIRED_FIELDS,
    optionalFields: ANTHROPIC_OPTIONAL_FIELDS,
    secretRefFields: ['apiKeyEnvVar'],
    rawSecretsLogged: false
  };
}

export function createAnthropicTeamProviderBridge(config: AnthropicTeamProviderConfig): AnthropicTeamProviderBridge {
  const configValidation = validateAnthropicTeamProviderConfig(config);
  const metadata: TeamProviderMetadata = {
    providerId: 'anthropic',
    displayName: 'Anthropic Messages direct Team runtime bridge',
    supportedRuntimeModes: ['real-agent', 'broker-only'],
    supportedArtifacts: ['agent-report', 'evidence-summary', 'atm.teamProviderRunArtifact.v1'],
    vendorNeutral: true
  };
  return {
    schemaId: 'atm.teamProviderContract.v1',
    bridgeSchemaId: 'atm.anthropicTeamProviderBridge.v1',
    config,
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
      if (request.providerId !== 'anthropic') {
        throw new Error(`Expected providerId anthropic; received ${request.providerId}.`);
      }
      if (request.runtimeMode !== 'real-agent') {
        throw new Error('anthropic bridge requires runtimeMode real-agent for direct provider runs.');
      }
      if (!configValidation.ok) {
        throw new Error(`Anthropic Team provider config is missing: ${configValidation.missingFields.join(', ')}`);
      }
      return {
        sessionId: `team-provider:${request.taskId}:${request.role}:anthropic:${config.modelId}`,
        providerId: 'anthropic'
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

export async function launchAnthropicTeamProviderRun(input: {
  readonly bridge: AnthropicTeamProviderBridge;
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'real-agent'; readonly providerId: 'anthropic' };
  readonly permissionPolicy: TeamPermissionPolicy;
  readonly scopedPaths: readonly string[];
  readonly executor?: TeamProviderHttpExecutor;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
  readonly emittedAt?: string;
}): Promise<OpenAIFamilyBridgeRunResult & { readonly providerId: 'anthropic'; readonly artifact: OpenAIFamilyRunArtifact & { readonly providerId: 'anthropic' } }> {
  const session = input.bridge.openSession(input.request);
  const permissionDecision = decideTeamPermission(input.permissionPolicy, {
    permission: 'exec.validator',
    providerId: input.request.providerId,
    scopedPaths: input.scopedPaths
  });
  const execution = permissionDecision.ok
    ? await executeAnthropicMessages({
      config: input.bridge.configValidation.ok ? input.bridge.config : null,
      request: input.request,
      sessionId: session.sessionId,
      scopedPaths: input.scopedPaths,
      executor: input.executor,
      env: input.env,
      timeoutMs: input.timeoutMs
    })
    : blockedExecutionResult();
  const artifact = createOpenAIFamilyRunArtifact({
    request: input.request,
    sessionId: session.sessionId,
    permissionDecision,
    secretRefFields: input.bridge.secretRefFields,
    execution
  }) as OpenAIFamilyRunArtifact & { readonly providerId: 'anthropic' };
  const observabilityEvents = createOpenAIFamilyObservabilityEvents({
    request: input.request,
    artifact,
    emittedAt: input.emittedAt
  });
  input.bridge.closeSession(session.sessionId);
  return {
    schemaId: 'atm.teamProviderBridgeRunResult.v1',
    ok: permissionDecision.ok && execution.ok,
    providerId: 'anthropic',
    sessionId: session.sessionId,
    artifact: {
      ...artifact,
      observabilityEventCount: observabilityEvents.length
    },
    observabilityEvents
  };
}

export function buildAnthropicTeamProviderBridgeDescriptor() {
  return {
    schemaId: 'atm.teamProviderBridgeDescriptor.v1',
    providerId: 'anthropic',
    bridgeSchemaId: 'atm.anthropicTeamProviderBridge.v1',
    configSchemaId: 'atm.anthropicTeamProviderConfig.v1',
    supportedRuntimeModes: ['real-agent', 'broker-only'] as const,
    requiredConfigRefs: ANTHROPIC_REQUIRED_FIELDS,
    optionalConfigRefs: ANTHROPIC_OPTIONAL_FIELDS,
    authModes: ['api-key-env'] as const,
    executionReadiness: 'vendor-execution-ready' as const,
    executionSurface: 'anthropic-messages-http' as const,
    brokerCheckedPermissions: ['exec.validator'] as const,
    artifactType: 'atm.teamProviderRunArtifact.v1',
    observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'] as const,
    sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'] as const,
    rawSecretsLogged: false as const
  };
}

async function executeAnthropicMessages(input: {
  readonly config: AnthropicTeamProviderConfig | null;
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'real-agent'; readonly providerId: 'anthropic' };
  readonly sessionId: string;
  readonly scopedPaths: readonly string[];
  readonly executor?: TeamProviderHttpExecutor;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult> {
  if (!input.config) {
    return {
      ok: false,
      outputText: '',
      retryable: false,
      summary: 'Anthropic execution config is unavailable.',
      executionMode: 'vendor-api'
    };
  }
  const env = input.env ?? process.env;
  const apiKey = env[input.config.apiKeyEnvVar];
  if (!apiKey) {
    return {
      ok: false,
      outputText: '',
      retryable: false,
      summary: `Anthropic API key env var ${input.config.apiKeyEnvVar} is not set.`,
      executionMode: 'vendor-api'
    };
  }
  const baseUrl = normalizeBaseUrl(input.config.baseUrlEnvVar ? env[input.config.baseUrlEnvVar] : null, 'https://api.anthropic.com/v1');
  return input.executor ? input.executor({
    url: `${baseUrl}/messages`,
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: {
      model: input.config.modelId,
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: input.request.input ?? input.request.instructions ?? `Run Team role ${input.request.role} for ${input.request.taskId}.`
      }],
      metadata: {
        user_id: input.sessionId
      }
    },
    timeoutMs: input.timeoutMs
  }) : {
    ok: false,
    outputText: '',
    retryable: false,
    summary: 'Anthropic live execution requires an injected executor in governed tests.',
    executionMode: 'vendor-api'
  };
}

function blockedExecutionResult(): TeamProviderExecutionResult {
  return {
    ok: false,
    outputText: '',
    retryable: false,
    summary: 'Permission broker blocked Anthropic provider execution.',
    executionMode: 'vendor-api'
  };
}

function normalizeBaseUrl(value: unknown, fallback: string) {
  const normalized = normalizeString(value);
  return normalized ? normalized.replace(/\/+$/, '') : fallback;
}

function normalizeString(value: unknown) {
  return String(value ?? '').trim();
}

import { decideTeamPermission, type TeamPermissionPolicy } from '../permission-broker.ts';
import { createTeamObservabilityEvent, type TeamObservabilityEvent } from '../observability.ts';
import {
  type TeamProviderContract,
  type TeamProviderExecutionResult,
  type TeamProviderHttpExecutor,
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
  readonly execution: {
    readonly mode: 'vendor-api';
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
  readonly config: OpenAITeamProviderConfig;
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

export async function launchOpenAITeamProviderRun(input: {
  readonly bridge: OpenAITeamProviderBridge;
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'real-agent' };
  readonly permissionPolicy: TeamPermissionPolicy;
  readonly scopedPaths: readonly string[];
  readonly executor?: TeamProviderHttpExecutor;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
  readonly emittedAt?: string;
}): Promise<OpenAIFamilyBridgeRunResult> {
  const session = input.bridge.openSession(input.request);
  const permissionDecision = decideTeamPermission(input.permissionPolicy, {
    permission: 'exec.validator',
    providerId: input.request.providerId,
    scopedPaths: input.scopedPaths
  });
  if (!permissionDecision.ok) {
    const artifact = createOpenAIFamilyRunArtifact({
      request: input.request,
      sessionId: session.sessionId,
      permissionDecision,
      secretRefFields: input.bridge.secretRefFields,
      execution: blockedExecutionResult()
    });
    const observabilityEvents = createOpenAIFamilyObservabilityEvents({
      request: input.request,
      artifact,
      emittedAt: input.emittedAt
    });
    input.bridge.closeSession(session.sessionId);
    return {
      schemaId: 'atm.teamProviderBridgeRunResult.v1',
      ok: false,
      providerId: 'openai',
      sessionId: session.sessionId,
      artifact: { ...artifact, observabilityEventCount: observabilityEvents.length },
      observabilityEvents
    };
  }
  const execution = await executeOpenAIResponses({
    config: input.bridge.configValidation.ok ? input.bridge.config : null,
    fallbackConfig: null,
    request: input.request,
    sessionId: session.sessionId,
    scopedPaths: input.scopedPaths,
    executor: input.executor,
    env: input.env,
    timeoutMs: input.timeoutMs
  });
  const artifact = createOpenAIFamilyRunArtifact({
    request: input.request,
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
    executionReadiness: 'vendor-execution-ready' as const,
    executionSurface: 'openai-responses-http' as const,
    brokerCheckedPermissions: ['exec.validator'] as const,
    artifactType: 'atm.teamProviderRunArtifact.v1',
    observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'] as const,
    sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'] as const,
    rawSecretsLogged: false as const
  };
}

export async function executeOpenAIResponses(input: {
  readonly config: OpenAITeamProviderConfig | null;
  readonly fallbackConfig: OpenAITeamProviderConfig | null;
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'real-agent' };
  readonly sessionId: string;
  readonly scopedPaths: readonly string[];
  readonly executor?: TeamProviderHttpExecutor;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult> {
  const config = input.config ?? input.fallbackConfig;
  if (!config) {
    return {
      ok: false,
      outputText: '',
      retryable: false,
      summary: 'OpenAI execution config is unavailable.',
      executionMode: 'vendor-api'
    };
  }
  const env = input.env ?? process.env;
  const apiKey = env[config.apiKeyEnvVar];
  if (!apiKey) {
    return missingSecretResult(config.apiKeyEnvVar, 'OpenAI');
  }
  const baseUrl = normalizeBaseUrl(config.baseUrlEnvVar ? env[config.baseUrlEnvVar] : null, 'https://api.openai.com/v1');
  const result = await (input.executor ?? defaultHttpJsonExecutor)({
    url: `${baseUrl}/responses`,
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(config.organizationEnvVar && env[config.organizationEnvVar] ? { 'OpenAI-Organization': env[config.organizationEnvVar] as string } : {}),
      ...(config.projectEnvVar && env[config.projectEnvVar] ? { 'OpenAI-Project': env[config.projectEnvVar] as string } : {})
    },
    body: {
      model: config.modelId,
      input: input.request.input ?? input.request.instructions ?? `Run Team role ${input.request.role} for ${input.request.taskId}.`,
      metadata: {
        taskId: input.request.taskId,
        role: input.request.role,
        sessionId: input.sessionId,
        scopedPathCount: input.scopedPaths.length
      }
    },
    timeoutMs: input.timeoutMs
  });
  return normalizeHttpExecutionResult(result, 'OpenAI Responses API');
}

export function createOpenAIFamilyRunArtifact(input: {
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'real-agent' };
  readonly sessionId: string;
  readonly permissionDecision: { readonly ok: boolean; readonly permission: string; readonly reason: string };
  readonly secretRefFields: readonly string[];
  readonly execution: TeamProviderExecutionResult;
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
    outputArtifacts: input.execution.outputArtifacts ?? ['agent-report', 'evidence-summary'],
    execution: {
      mode: 'vendor-api',
      statusCode: input.execution.statusCode,
      retryable: input.execution.retryable,
      outputTextPreview: redactPreview(input.execution.outputText)
    },
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

export async function defaultHttpJsonExecutor(input: {
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
    const parsed = parseJson(text);
    return {
      ok: response.ok,
      statusCode: response.status,
      outputText: extractProviderText(parsed) || text,
      retryable: response.status === 429 || response.status >= 500,
      summary: response.ok ? 'Vendor API request completed.' : `Vendor API request failed with HTTP ${response.status}.`,
      executionMode: 'vendor-api'
    };
  } catch (error) {
    return {
      ok: false,
      outputText: error instanceof Error ? error.message : String(error),
      retryable: true,
      summary: 'Vendor API request failed before a response was returned.',
      executionMode: 'vendor-api'
    };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function normalizeHttpExecutionResult(result: TeamProviderExecutionResult, label: string): TeamProviderExecutionResult {
  return {
    ...result,
    summary: result.summary || `${label} execution ${result.ok ? 'completed' : 'failed'}.`,
    executionMode: 'vendor-api'
  };
}

export function missingSecretResult(secretRef: string, label: string): TeamProviderExecutionResult {
  return {
    ok: false,
    outputText: '',
    retryable: false,
    summary: `${label} execution requires environment variable ${secretRef}.`,
    executionMode: 'vendor-api'
  };
}

export function blockedExecutionResult(): TeamProviderExecutionResult {
  return {
    ok: false,
    outputText: '',
    retryable: false,
    summary: 'Execution blocked by Team permission broker.',
    executionMode: 'vendor-api'
  };
}

export function normalizeBaseUrl(value: string | null | undefined, fallback: string): string {
  return String(value || fallback).replace(/\/+$/, '');
}

export function extractProviderText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.output_text === 'string') return record.output_text;
  if (Array.isArray(record.output)) {
    return record.output.map((entry) => extractProviderText(entry)).filter(Boolean).join('\n');
  }
  if (Array.isArray(record.content)) {
    return record.content.map((entry) => extractProviderText(entry)).filter(Boolean).join('\n');
  }
  if (typeof record.text === 'string') return record.text;
  if (record.text && typeof record.text === 'object' && typeof (record.text as Record<string, unknown>).value === 'string') {
    return (record.text as Record<string, string>).value;
  }
  if (Array.isArray(record.choices)) {
    return record.choices.map((choice) => extractProviderText((choice as Record<string, unknown>).message ?? choice)).filter(Boolean).join('\n');
  }
  return '';
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function redactPreview(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500);
}

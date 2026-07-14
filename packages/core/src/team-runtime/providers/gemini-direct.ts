import { decideTeamPermission, type TeamPermissionPolicy } from '../permission-broker.ts';
import { createTeamObservabilityEvent, type TeamObservabilityEvent } from '../observability.ts';
import {
  type TeamProviderContract,
  type TeamProviderExecutionResult,
  type TeamProviderHttpExecutor,
  type TeamProviderMetadata,
  type TeamProviderSessionRequest
} from '../provider-contract.ts';
import {
  blockedExecutionResult,
  defaultHttpJsonExecutor,
  missingSecretResult,
  normalizeBaseUrl,
  normalizeHttpExecutionResult
} from './openai.ts';

export type GeminiDirectTeamProviderConfig = {
  readonly schemaId: 'atm.geminiDirectTeamProviderConfig.v1';
  readonly providerId: 'gemini-direct';
  readonly sdkId: 'gemini-generate-content';
  readonly modelId: string;
  readonly apiKeyEnvVar: string;
  readonly baseUrlEnvVar?: string | null;
};

export type GeminiDirectTeamProviderBridge = TeamProviderContract & {
  readonly bridgeSchemaId: 'atm.geminiDirectTeamProviderBridge.v1';
  readonly config: GeminiDirectTeamProviderConfig;
  readonly secretRefFields: readonly string[];
};

export function createGeminiDirectTeamProviderBridge(config: GeminiDirectTeamProviderConfig): GeminiDirectTeamProviderBridge {
  const metadata: TeamProviderMetadata = {
    providerId: 'gemini-direct',
    displayName: 'Gemini direct Team runtime bridge',
    supportedRuntimeModes: ['real-agent', 'broker-only'],
    supportedArtifacts: ['agent-report', 'evidence-summary', 'atm.teamProviderRunArtifact.v1'],
    vendorNeutral: true
  };
  return {
    schemaId: 'atm.teamProviderContract.v1',
    bridgeSchemaId: 'atm.geminiDirectTeamProviderBridge.v1',
    config,
    metadata,
    secretRefFields: ['apiKeyEnvVar'],
    sessionLifecycle: { createSession: true, closeSession: true, cancelSession: true, retryStep: true },
    openSession(request) {
      if (request.providerId !== 'gemini-direct' || request.runtimeMode !== 'real-agent') {
        throw new Error('Gemini Direct bridge requires providerId gemini-direct and runtimeMode real-agent.');
      }
      return { sessionId: `team-provider:${request.taskId}:${request.role}:gemini-direct:${config.modelId}`, providerId: 'gemini-direct' };
    },
    closeSession: (sessionId) => ({ closed: true, sessionId }),
    cancelSession: (sessionId, reason) => ({ cancelled: true, sessionId, reason })
  };
}

export async function launchGeminiDirectTeamProviderRun(input: {
  readonly bridge: GeminiDirectTeamProviderBridge;
  readonly request: TeamProviderSessionRequest & { readonly providerId: 'gemini-direct'; readonly runtimeMode: 'real-agent' };
  readonly permissionPolicy: TeamPermissionPolicy;
  readonly scopedPaths: readonly string[];
  readonly executor?: TeamProviderHttpExecutor;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
  readonly emittedAt?: string;
}) {
  const session = input.bridge.openSession(input.request);
  const permissionDecision = decideTeamPermission(input.permissionPolicy, {
    permission: 'exec.validator', providerId: 'gemini-direct', scopedPaths: input.scopedPaths
  });
  const execution = permissionDecision.ok
    ? await executeGeminiGenerateContent({
      config: input.bridge.config, request: input.request, executor: input.executor,
      env: input.env, timeoutMs: input.timeoutMs
    })
    : blockedExecutionResult();
  const preview = redactPreview(execution.outputText);
  const artifact = {
    schemaId: 'atm.teamProviderRunArtifact.v1' as const,
    specVersion: '0.1.0' as const,
    artifactType: 'atm.teamProviderRunArtifact.v1' as const,
    taskId: input.request.taskId,
    role: input.request.role,
    providerId: 'gemini-direct' as const,
    sdkId: input.request.sdkId,
    modelId: input.request.modelId,
    runtimeMode: 'real-agent' as const,
    sessionId: session.sessionId,
    permissionDecision,
    outputArtifacts: execution.outputArtifacts ?? ['agent-report', 'evidence-summary'],
    execution: { mode: 'vendor-api' as const, statusCode: execution.statusCode, retryable: execution.retryable, outputTextPreview: preview },
    billableUsage: execution.billableUsage,
    observabilityEventCount: 3,
    redaction: { rawSecretsLogged: false as const, secretRefFields: input.bridge.secretRefFields }
  };
  const common = { taskId: input.request.taskId, teamRunId: session.sessionId, providerId: 'gemini-direct' as const, role: input.request.role, runtimeMode: 'real-agent' as const, emittedAt: input.emittedAt };
  const observabilityEvents: TeamObservabilityEvent[] = [
    createTeamObservabilityEvent({ ...common, eventType: 'session.start', summary: 'gemini-direct real-agent session opened through the shared Team provider contract.' }),
    createTeamObservabilityEvent({ ...common, eventType: 'artifact.output', artifactType: artifact.artifactType, artifactId: session.sessionId, summary: 'gemini-direct emitted the shared Team provider run artifact.' }),
    createTeamObservabilityEvent({ ...common, eventType: 'session.complete', summary: 'gemini-direct real-agent session closed under coordinator-owned authority.' })
  ];
  input.bridge.closeSession(session.sessionId);
  return { schemaId: 'atm.teamProviderBridgeRunResult.v1' as const, ok: permissionDecision.ok && execution.ok, providerId: 'gemini-direct' as const, sessionId: session.sessionId, artifact, observabilityEvents };
}

export async function executeGeminiGenerateContent(input: {
  readonly config: GeminiDirectTeamProviderConfig;
  readonly request: TeamProviderSessionRequest & { readonly providerId: 'gemini-direct'; readonly runtimeMode: 'real-agent' };
  readonly executor?: TeamProviderHttpExecutor;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult> {
  const env = input.env ?? process.env;
  const apiKey = env[input.config.apiKeyEnvVar];
  if (!apiKey) return missingSecretResult(input.config.apiKeyEnvVar, 'Gemini Direct');
  const baseUrl = normalizeBaseUrl(input.config.baseUrlEnvVar ? env[input.config.baseUrlEnvVar] : null, 'https://generativelanguage.googleapis.com/v1beta');
  const result = await (input.executor ?? defaultHttpJsonExecutor)({
    url: `${baseUrl}/models/${encodeURIComponent(input.config.modelId)}:generateContent`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: { contents: [{ role: 'user', parts: [{ text: input.request.input ?? input.request.instructions ?? `Run Team role ${input.request.role} for ${input.request.taskId}.` }] }] },
    timeoutMs: input.timeoutMs
  });
  return normalizeHttpExecutionResult({ ...result, outputText: extractGeminiText(result.outputText) }, 'Gemini GenerateContent API');
}

export function buildGeminiDirectTeamProviderBridgeDescriptor() {
  return {
    schemaId: 'atm.teamProviderBridgeDescriptor.v1', providerId: 'gemini-direct',
    bridgeSchemaId: 'atm.geminiDirectTeamProviderBridge.v1', configSchemaId: 'atm.geminiDirectTeamProviderConfig.v1',
    supportedRuntimeModes: ['real-agent', 'broker-only'] as const,
    requiredConfigRefs: ['modelId', 'apiKeyEnvVar'] as const, optionalConfigRefs: ['baseUrlEnvVar'] as const,
    authModes: ['api-key-env'] as const, executionReadiness: 'vendor-execution-ready' as const,
    executionSurface: 'gemini-generate-content-http' as const, brokerCheckedPermissions: ['exec.validator'] as const,
    artifactType: 'atm.teamProviderRunArtifact.v1', observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'] as const,
    sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'] as const,
    rawSecretsLogged: false as const
  };
}

function extractGeminiText(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    return parsed.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text ?? '').filter(Boolean).join('\n') || raw;
  } catch { return raw; }
}

function redactPreview(text: string): string {
  return text.replace(/(?:AIza|sk-)[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500);
}

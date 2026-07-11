import { decideTeamPermission } from '../permission-broker.js';
import { createTeamObservabilityEvent } from '../observability.js';
import { blockedExecutionResult, defaultHttpJsonExecutor, missingSecretResult, normalizeBaseUrl, normalizeHttpExecutionResult } from './openai.js';
export function createGeminiDirectTeamProviderBridge(config) {
    const metadata = {
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
export async function launchGeminiDirectTeamProviderRun(input) {
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
        schemaId: 'atm.teamProviderRunArtifact.v1',
        specVersion: '0.1.0',
        artifactType: 'atm.teamProviderRunArtifact.v1',
        taskId: input.request.taskId,
        role: input.request.role,
        providerId: 'gemini-direct',
        sdkId: input.request.sdkId,
        modelId: input.request.modelId,
        runtimeMode: 'real-agent',
        sessionId: session.sessionId,
        permissionDecision,
        outputArtifacts: execution.outputArtifacts ?? ['agent-report', 'evidence-summary'],
        execution: { mode: 'vendor-api', statusCode: execution.statusCode, retryable: execution.retryable, outputTextPreview: preview },
        observabilityEventCount: 3,
        redaction: { rawSecretsLogged: false, secretRefFields: input.bridge.secretRefFields }
    };
    const common = { taskId: input.request.taskId, teamRunId: session.sessionId, providerId: 'gemini-direct', role: input.request.role, runtimeMode: 'real-agent', emittedAt: input.emittedAt };
    const observabilityEvents = [
        createTeamObservabilityEvent({ ...common, eventType: 'session.start', summary: 'gemini-direct real-agent session opened through the shared Team provider contract.' }),
        createTeamObservabilityEvent({ ...common, eventType: 'artifact.output', artifactType: artifact.artifactType, artifactId: session.sessionId, summary: 'gemini-direct emitted the shared Team provider run artifact.' }),
        createTeamObservabilityEvent({ ...common, eventType: 'session.complete', summary: 'gemini-direct real-agent session closed under coordinator-owned authority.' })
    ];
    input.bridge.closeSession(session.sessionId);
    return { schemaId: 'atm.teamProviderBridgeRunResult.v1', ok: permissionDecision.ok && execution.ok, providerId: 'gemini-direct', sessionId: session.sessionId, artifact, observabilityEvents };
}
export async function executeGeminiGenerateContent(input) {
    const env = input.env ?? process.env;
    const apiKey = env[input.config.apiKeyEnvVar];
    if (!apiKey)
        return missingSecretResult(input.config.apiKeyEnvVar, 'Gemini Direct');
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
        supportedRuntimeModes: ['real-agent', 'broker-only'],
        requiredConfigRefs: ['modelId', 'apiKeyEnvVar'], optionalConfigRefs: ['baseUrlEnvVar'],
        authModes: ['api-key-env'], executionReadiness: 'vendor-execution-ready',
        executionSurface: 'gemini-generate-content-http', brokerCheckedPermissions: ['exec.validator'],
        artifactType: 'atm.teamProviderRunArtifact.v1', observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'],
        sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        rawSecretsLogged: false
    };
}
function extractGeminiText(raw) {
    try {
        const parsed = JSON.parse(raw);
        return parsed.candidates?.flatMap((candidate) => candidate.content?.parts ?? []).map((part) => part.text ?? '').filter(Boolean).join('\n') || raw;
    }
    catch {
        return raw;
    }
}
function redactPreview(text) {
    return text.replace(/(?:AIza|sk-)[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500);
}

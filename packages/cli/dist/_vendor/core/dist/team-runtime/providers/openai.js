import { decideTeamPermission } from '../permission-broker.js';
import { createTeamObservabilityEvent } from '../observability.js';
const OPENAI_REQUIRED_FIELDS = ['modelId', 'apiKeyEnvVar'];
const OPENAI_OPTIONAL_FIELDS = ['baseUrlEnvVar', 'organizationEnvVar', 'projectEnvVar'];
export function validateOpenAITeamProviderConfig(config) {
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
export function createOpenAITeamProviderBridge(config) {
    const configValidation = validateOpenAITeamProviderConfig(config);
    const metadata = {
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
export async function launchOpenAITeamProviderRun(input) {
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
        supportedRuntimeModes: ['real-agent', 'broker-only'],
        requiredConfigRefs: OPENAI_REQUIRED_FIELDS,
        optionalConfigRefs: OPENAI_OPTIONAL_FIELDS,
        authModes: ['api-key-env'],
        executionReadiness: 'vendor-execution-ready',
        executionSurface: 'openai-responses-http',
        brokerCheckedPermissions: ['exec.validator'],
        artifactType: 'atm.teamProviderRunArtifact.v1',
        observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'],
        sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        rawSecretsLogged: false
    };
}
export async function executeOpenAIResponses(input) {
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
            ...(config.organizationEnvVar && env[config.organizationEnvVar] ? { 'OpenAI-Organization': env[config.organizationEnvVar] } : {}),
            ...(config.projectEnvVar && env[config.projectEnvVar] ? { 'OpenAI-Project': env[config.projectEnvVar] } : {})
        },
        body: {
            model: config.modelId,
            input: input.request.input ?? input.request.instructions ?? `Run Team role ${input.request.role} for ${input.request.taskId}.`,
            metadata: {
                taskId: input.request.taskId,
                role: input.request.role,
                sessionId: input.sessionId,
                scopedPathCount: String(input.scopedPaths.length)
            }
        },
        timeoutMs: input.timeoutMs
    });
    return normalizeHttpExecutionResult(result, 'OpenAI Responses API');
}
export function createOpenAIFamilyRunArtifact(input) {
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
        billableUsage: input.execution.billableUsage,
        observabilityEventCount: 0,
        redaction: {
            rawSecretsLogged: false,
            secretRefFields: input.secretRefFields
        }
    };
}
export function createOpenAIFamilyObservabilityEvents(input) {
    const common = {
        taskId: input.request.taskId,
        teamRunId: input.artifact.sessionId,
        providerId: input.request.providerId,
        role: input.request.role,
        runtimeMode: 'real-agent',
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
function assertOpenAIRequest(request, providerId) {
    if (request.providerId !== providerId) {
        throw new Error(`Expected providerId ${providerId}; received ${request.providerId}.`);
    }
    if (request.runtimeMode !== 'real-agent') {
        throw new Error(`${providerId} bridge requires runtimeMode real-agent for direct provider runs.`);
    }
}
function normalizeString(value) {
    return String(value ?? '').trim();
}
function stableSessionId(taskId, role, providerId, modelId) {
    return `team-provider:${taskId}:${role}:${providerId}:${modelId}`;
}
export async function defaultHttpJsonExecutor(input) {
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
            billableUsage: response.ok ? extractOpenAIResponsesBillableUsage(parsed) : undefined,
            retryable: response.status === 429 || response.status >= 500,
            summary: response.ok ? 'Vendor API request completed.' : `Vendor API request failed with HTTP ${response.status}.`,
            executionMode: 'vendor-api'
        };
    }
    catch (error) {
        return {
            ok: false,
            outputText: error instanceof Error ? error.message : String(error),
            retryable: true,
            summary: 'Vendor API request failed before a response was returned.',
            executionMode: 'vendor-api'
        };
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
export function extractOpenAIResponsesBillableUsage(value) {
    if (!value || typeof value !== 'object')
        return undefined;
    const record = value;
    const usage = record.usage;
    if (!usage || typeof usage !== 'object')
        return undefined;
    const usageRecord = usage;
    const inputTokens = numberField(usageRecord.input_tokens);
    const outputTokens = numberField(usageRecord.output_tokens);
    const inputDetails = objectField(usageRecord.input_tokens_details);
    const outputDetails = objectField(usageRecord.output_tokens_details);
    const cacheReadTokens = numberField(inputDetails?.cached_tokens);
    const reasoningTokens = numberField(outputDetails?.reasoning_tokens);
    return {
        schemaId: 'atm.teamProviderBillableUsage.v1',
        providerId: 'openai',
        modelId: stringField(record.model) ?? 'unknown-openai-model',
        billingProduct: 'responses-api',
        serviceTier: stringField(record.service_tier) ?? 'standard',
        region: 'global',
        currency: 'USD',
        inputTokens,
        outputTokens,
        cacheReadTokens,
        reasoningTokens,
        requestCount: 1,
        retryCount: 0,
        billedFailedOrCancelled: false,
        measurementIncompleteReasons: [
            ...(inputTokens == null ? ['missing-input-tokens'] : []),
            ...(outputTokens == null ? ['missing-output-tokens'] : [])
        ]
    };
}
function objectField(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}
function numberField(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function stringField(value) {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized : undefined;
}
export function normalizeHttpExecutionResult(result, label) {
    return {
        ...result,
        summary: result.summary || `${label} execution ${result.ok ? 'completed' : 'failed'}.`,
        executionMode: 'vendor-api'
    };
}
export function missingSecretResult(secretRef, label) {
    return {
        ok: false,
        outputText: '',
        retryable: false,
        summary: `${label} execution requires environment variable ${secretRef}.`,
        executionMode: 'vendor-api'
    };
}
export function blockedExecutionResult() {
    return {
        ok: false,
        outputText: '',
        retryable: false,
        summary: 'Execution blocked by Team permission broker.',
        executionMode: 'vendor-api'
    };
}
export function normalizeBaseUrl(value, fallback) {
    return String(value || fallback).replace(/\/+$/, '');
}
export function extractProviderText(value) {
    if (!value || typeof value !== 'object')
        return '';
    const record = value;
    if (typeof record.output_text === 'string')
        return record.output_text;
    if (Array.isArray(record.output)) {
        return record.output.map((entry) => extractProviderText(entry)).filter(Boolean).join('\n');
    }
    if (Array.isArray(record.content)) {
        return record.content.map((entry) => extractProviderText(entry)).filter(Boolean).join('\n');
    }
    if (typeof record.text === 'string')
        return record.text;
    if (record.text && typeof record.text === 'object' && typeof record.text.value === 'string') {
        return record.text.value;
    }
    if (Array.isArray(record.choices)) {
        return record.choices.map((choice) => extractProviderText(choice.message ?? choice)).filter(Boolean).join('\n');
    }
    return '';
}
function parseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
function redactPreview(text) {
    return text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500);
}

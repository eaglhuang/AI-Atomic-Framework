import { decideTeamPermission } from '../permission-broker.js';
import { createOpenAIFamilyObservabilityEvents, createOpenAIFamilyRunArtifact, missingSecretResult, normalizeBaseUrl, normalizeHttpExecutionResult } from './openai.js';
const AZURE_BASE_REQUIRED_FIELDS = ['endpointEnvVar', 'deploymentName', 'modelId', 'authMode'];
export function validateAzureOpenAITeamProviderConfig(config) {
    const authMode = normalizeAuthMode(config.authMode);
    const requiredFields = [
        ...AZURE_BASE_REQUIRED_FIELDS,
        ...(authMode === 'api-key-env' ? ['apiKeyEnvVar'] : []),
        ...(authMode === 'managed-identity' ? ['tenantIdEnvVar'] : [])
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
export function createAzureOpenAITeamProviderBridge(config) {
    const configValidation = validateAzureOpenAITeamProviderConfig(config);
    const metadata = {
        providerId: 'azure-openai',
        displayName: 'Azure OpenAI direct Team runtime bridge',
        supportedRuntimeModes: ['real-agent', 'broker-only'],
        supportedArtifacts: ['agent-report', 'evidence-summary', 'atm.teamProviderRunArtifact.v1'],
        vendorNeutral: true
    };
    return {
        schemaId: 'atm.teamProviderContract.v1',
        bridgeSchemaId: 'atm.azureOpenAITeamProviderBridge.v1',
        config,
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
export async function launchAzureOpenAITeamProviderRun(input) {
    const session = input.bridge.openSession(input.request);
    const permissionDecision = decideTeamPermission(input.permissionPolicy, {
        permission: 'exec.validator',
        providerId: input.request.providerId,
        scopedPaths: input.scopedPaths
    });
    const execution = permissionDecision.ok
        ? await executeAzureOpenAIResponses({
            config: input.bridge.config,
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
            executionMode: 'vendor-api'
        };
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
        providerId: 'azure-openai',
        sessionId: session.sessionId,
        artifact: {
            ...artifact,
            observabilityEventCount: observabilityEvents.length
        },
        observabilityEvents
    };
}
export async function executeAzureOpenAIResponses(input) {
    const env = input.env ?? process.env;
    const endpoint = env[input.config.endpointEnvVar];
    if (!endpoint)
        return missingSecretResult(input.config.endpointEnvVar, 'Azure OpenAI endpoint');
    const headers = { 'Content-Type': 'application/json' };
    if (input.config.authMode === 'api-key-env') {
        const apiKeyRef = input.config.apiKeyEnvVar ?? '';
        const apiKey = env[apiKeyRef];
        if (!apiKey)
            return missingSecretResult(apiKeyRef, 'Azure OpenAI API key');
        headers['api-key'] = apiKey;
    }
    else {
        const tokenRef = 'AZURE_OPENAI_BEARER_TOKEN';
        const token = env[tokenRef] ?? env.AZURE_ACCESS_TOKEN;
        if (!token)
            return missingSecretResult(tokenRef, 'Azure OpenAI managed identity bearer token');
        headers.Authorization = `Bearer ${token}`;
    }
    const apiVersion = env.AZURE_OPENAI_API_VERSION ?? '2025-04-01-preview';
    const result = await (input.executor ?? defaultAzureHttpExecutor)({
        url: `${normalizeBaseUrl(endpoint, endpoint)}/openai/deployments/${encodeURIComponent(input.config.deploymentName)}/responses?api-version=${encodeURIComponent(apiVersion)}`,
        method: 'POST',
        headers,
        body: {
            model: input.config.modelId,
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
    return normalizeHttpExecutionResult(result, 'Azure OpenAI Responses API');
}
export function buildAzureOpenAITeamProviderBridgeDescriptor() {
    return {
        schemaId: 'atm.teamProviderBridgeDescriptor.v1',
        providerId: 'azure-openai',
        bridgeSchemaId: 'atm.azureOpenAITeamProviderBridge.v1',
        configSchemaId: 'atm.azureOpenAITeamProviderConfig.v1',
        supportedRuntimeModes: ['real-agent', 'broker-only'],
        requiredConfigRefs: AZURE_BASE_REQUIRED_FIELDS,
        authModes: ['api-key-env', 'managed-identity'],
        executionReadiness: 'vendor-execution-ready',
        executionSurface: 'azure-openai-responses-http',
        brokerCheckedPermissions: ['exec.validator'],
        artifactType: 'atm.teamProviderRunArtifact.v1',
        observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'],
        sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        rawSecretsLogged: false
    };
}
function assertAzureOpenAIRequest(request) {
    if (request.providerId !== 'azure-openai') {
        throw new Error(`Expected providerId azure-openai; received ${request.providerId}.`);
    }
    if (request.runtimeMode !== 'real-agent') {
        throw new Error('azure-openai bridge requires runtimeMode real-agent for direct provider runs.');
    }
}
function normalizeAuthMode(value) {
    const normalized = normalizeString(value);
    return normalized === 'api-key-env' || normalized === 'managed-identity' ? normalized : null;
}
function normalizeString(value) {
    return String(value ?? '').trim();
}
function uniqueStrings(values) {
    return [...new Set(values)];
}
async function defaultAzureHttpExecutor(input) {
    const { executeOpenAIResponses } = await import('./openai.js');
    return executeOpenAIResponses({
        config: {
            schemaId: 'atm.openaiTeamProviderConfig.v1',
            providerId: 'openai',
            sdkId: 'openai-responses',
            modelId: 'azure-proxy',
            apiKeyEnvVar: 'ATM_INTERNAL_UNUSED'
        },
        fallbackConfig: null,
        request: {
            taskId: 'azure-openai-proxy',
            role: 'executor',
            runtimeMode: 'real-agent',
            providerId: 'openai',
            sdkId: 'openai-responses',
            modelId: 'azure-proxy'
        },
        sessionId: 'azure-openai-proxy',
        scopedPaths: [],
        executor: async () => {
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
                    summary: response.ok ? 'Azure OpenAI request completed.' : `Azure OpenAI request failed with HTTP ${response.status}.`,
                    executionMode: 'vendor-api'
                };
            }
            finally {
                if (timeout)
                    clearTimeout(timeout);
            }
        },
        env: { ATM_INTERNAL_UNUSED: 'unused' }
    });
}

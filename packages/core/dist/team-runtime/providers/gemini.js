import { decideTeamPermission } from '../permission-broker.js';
import { assertEditorExecutionRequest, createTeamExecutionBridgeObservabilityEvents, createTeamExecutionBridgeRunArtifact, defaultCommandExecutor, blockedCommandExecutionResult } from './claude-code.js';
const GEMINI_REQUIRED_FIELDS = ['modelId', 'cliCommand', 'roleEnvelopeSchemaId'];
export function validateGeminiTeamProviderConfig(config) {
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
export function createGeminiTeamProviderBridge(config) {
    const configValidation = validateGeminiTeamProviderConfig(config);
    const metadata = {
        providerId: 'gemini',
        displayName: 'Gemini CLI-style Team runtime bridge',
        supportedRuntimeModes: ['editor-subagent', 'broker-only'],
        supportedArtifacts: ['agent-report', 'evidence-summary', 'atm.teamProviderRunArtifact.v1'],
        vendorNeutral: true
    };
    return {
        schemaId: 'atm.teamProviderContract.v1',
        bridgeSchemaId: 'atm.geminiTeamProviderBridge.v1',
        config,
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
export async function launchGeminiTeamProviderRun(input) {
    const session = input.bridge.openSession(input.request);
    const permissionDecision = decideTeamPermission(input.permissionPolicy, {
        permission: 'exec.validator',
        providerId: input.request.providerId,
        scopedPaths: input.scopedPaths
    });
    const execution = permissionDecision.ok
        ? await executeGeminiCommand({
            config: input.bridge.config,
            request: input.request,
            sessionId: session.sessionId,
            scopedPaths: input.scopedPaths,
            permissionLeases: input.permissionLeases ?? ['exec.validator'],
            executor: input.executor,
            cwd: input.cwd,
            env: input.env,
            timeoutMs: input.timeoutMs
        })
        : blockedCommandExecutionResult();
    const artifact = createTeamExecutionBridgeRunArtifact({
        request: input.request,
        sessionId: session.sessionId,
        executionSurface: input.bridge.executionSurface,
        allowedFiles: input.scopedPaths,
        permissionLeases: input.permissionLeases ?? ['exec.validator'],
        permissionDecision,
        secretRefFields: input.bridge.secretRefFields,
        execution
    });
    const observabilityEvents = createTeamExecutionBridgeObservabilityEvents({
        request: input.request,
        artifact,
        emittedAt: input.emittedAt
    });
    input.bridge.closeSession(session.sessionId);
    return {
        schemaId: 'atm.teamProviderBridgeRunResult.v1',
        ok: permissionDecision.ok && execution.ok,
        providerId: 'gemini',
        sessionId: session.sessionId,
        artifact: {
            ...artifact,
            observabilityEventCount: observabilityEvents.length
        },
        observabilityEvents
    };
}
export async function executeGeminiCommand(input) {
    const stdin = JSON.stringify({
        schemaId: 'atm.teamEditorSubagentRoleEnvelope.v1',
        taskId: input.request.taskId,
        role: input.request.role,
        providerId: input.request.providerId,
        sdkId: input.request.sdkId,
        modelId: input.request.modelId,
        runtimeMode: input.request.runtimeMode,
        allowedFiles: input.scopedPaths,
        permissionLeases: input.permissionLeases,
        coordinatorOwnedAuthority: true,
        instructions: input.request.instructions ?? input.request.input ?? `Run Team role ${input.request.role} for ${input.request.taskId}.`
    });
    return (input.executor ?? defaultCommandExecutor)({
        command: input.config.cliCommand,
        args: ['--model', input.config.modelId],
        cwd: input.cwd,
        env: input.env,
        timeoutMs: input.timeoutMs,
        stdin
    });
}
export function buildGeminiTeamProviderBridgeDescriptor() {
    return {
        schemaId: 'atm.teamProviderBridgeDescriptor.v1',
        providerId: 'gemini',
        bridgeSchemaId: 'atm.geminiTeamProviderBridge.v1',
        configSchemaId: 'atm.geminiTeamProviderConfig.v1',
        roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1',
        executionSurface: 'cli-style',
        supportedRuntimeModes: ['editor-subagent', 'broker-only'],
        requiredConfigRefs: GEMINI_REQUIRED_FIELDS,
        authModes: ['cli-auth'],
        executionReadiness: 'vendor-execution-ready',
        brokerCheckedPermissions: ['exec.validator'],
        artifactType: 'atm.teamProviderRunArtifact.v1',
        observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'],
        sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        rawSecretsLogged: false
    };
}
function normalizeString(value) {
    return String(value ?? '').trim();
}
function uniqueStrings(values) {
    return [...new Set(values)];
}

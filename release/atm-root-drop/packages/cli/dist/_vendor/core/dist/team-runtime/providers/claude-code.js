import { decideTeamPermission } from '../permission-broker.js';
import { createTeamObservabilityEvent } from '../observability.js';
import { spawn } from 'node:child_process';
const CLAUDE_CODE_REQUIRED_FIELDS = ['modelId', 'editorCommand', 'roleEnvelopeSchemaId'];
export function validateClaudeCodeTeamProviderConfig(config) {
    const missingFields = CLAUDE_CODE_REQUIRED_FIELDS.filter((field) => !normalizeString(config[field]));
    return {
        schemaId: 'atm.claudeCodeTeamProviderConfigValidation.v1',
        providerId: 'claude-code',
        ok: missingFields.length === 0 && config.roleEnvelopeSchemaId === 'atm.teamEditorSubagentRoleEnvelope.v1',
        missingFields: config.roleEnvelopeSchemaId && config.roleEnvelopeSchemaId !== 'atm.teamEditorSubagentRoleEnvelope.v1'
            ? uniqueStrings([...missingFields, 'roleEnvelopeSchemaId'])
            : missingFields,
        requiredFields: CLAUDE_CODE_REQUIRED_FIELDS,
        secretRefFields: [],
        rawSecretsLogged: false
    };
}
export function createClaudeCodeTeamProviderBridge(config) {
    const configValidation = validateClaudeCodeTeamProviderConfig(config);
    const metadata = {
        providerId: 'claude-code',
        displayName: 'Claude Code editor-subagent Team runtime bridge',
        supportedRuntimeModes: ['editor-subagent', 'broker-only'],
        supportedArtifacts: ['agent-report', 'evidence-summary', 'atm.teamProviderRunArtifact.v1'],
        vendorNeutral: true
    };
    return {
        schemaId: 'atm.teamProviderContract.v1',
        bridgeSchemaId: 'atm.claudeCodeTeamProviderBridge.v1',
        config,
        metadata,
        configValidation,
        secretRefFields: [],
        executionSurface: 'editor-subagent',
        sessionLifecycle: {
            createSession: true,
            closeSession: true,
            cancelSession: true,
            retryStep: true
        },
        openSession(request) {
            assertEditorExecutionRequest(request, 'claude-code');
            if (!configValidation.ok) {
                throw new Error(`Claude Code Team provider config is missing: ${configValidation.missingFields.join(', ')}`);
            }
            return {
                sessionId: stableSessionId(request.taskId, request.role, 'claude-code', config.modelId),
                providerId: 'claude-code'
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
export async function launchClaudeCodeTeamProviderRun(input) {
    const session = input.bridge.openSession(input.request);
    const permissionDecision = decideTeamPermission(input.permissionPolicy, {
        permission: 'exec.validator',
        providerId: input.request.providerId,
        scopedPaths: input.scopedPaths
    });
    const execution = permissionDecision.ok
        ? await executeClaudeCodeCommand({
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
        providerId: 'claude-code',
        sessionId: session.sessionId,
        artifact: {
            ...artifact,
            observabilityEventCount: observabilityEvents.length
        },
        observabilityEvents
    };
}
export async function executeClaudeCodeCommand(input) {
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
        command: input.config.editorCommand,
        args: ['--model', input.config.modelId, '--print'],
        cwd: input.cwd,
        env: input.env,
        timeoutMs: input.timeoutMs,
        stdin
    });
}
export function buildClaudeCodeTeamProviderBridgeDescriptor() {
    return {
        schemaId: 'atm.teamProviderBridgeDescriptor.v1',
        providerId: 'claude-code',
        bridgeSchemaId: 'atm.claudeCodeTeamProviderBridge.v1',
        configSchemaId: 'atm.claudeCodeTeamProviderConfig.v1',
        roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1',
        executionSurface: 'editor-subagent',
        supportedRuntimeModes: ['editor-subagent', 'broker-only'],
        requiredConfigRefs: CLAUDE_CODE_REQUIRED_FIELDS,
        authModes: ['editor-session'],
        executionReadiness: 'vendor-execution-ready',
        brokerCheckedPermissions: ['exec.validator'],
        artifactType: 'atm.teamProviderRunArtifact.v1',
        observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'],
        sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
        rawSecretsLogged: false
    };
}
export function createTeamExecutionBridgeRunArtifact(input) {
    return {
        schemaId: 'atm.teamProviderRunArtifact.v1',
        specVersion: '0.1.0',
        artifactType: 'atm.teamProviderRunArtifact.v1',
        taskId: input.request.taskId,
        role: input.request.role,
        providerId: input.request.providerId,
        sdkId: input.request.sdkId,
        modelId: input.request.modelId,
        runtimeMode: 'editor-subagent',
        sessionId: input.sessionId,
        roleEnvelope: createTeamEditorSubagentRoleEnvelope({
            request: input.request,
            executionSurface: input.executionSurface,
            allowedFiles: input.allowedFiles,
            permissionLeases: input.permissionLeases
        }),
        permissionDecision: input.permissionDecision,
        outputArtifacts: input.execution.outputArtifacts ?? ['agent-report', 'evidence-summary'],
        execution: {
            mode: 'editor-cli',
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
export function createTeamExecutionBridgeObservabilityEvents(input) {
    const common = {
        taskId: input.request.taskId,
        teamRunId: input.artifact.sessionId,
        providerId: input.request.providerId,
        role: input.request.role,
        runtimeMode: 'editor-subagent',
        emittedAt: input.emittedAt
    };
    return [
        createTeamObservabilityEvent({
            ...common,
            eventType: 'session.start',
            summary: `${input.request.providerId} editor-subagent session opened through the shared Team provider contract.`
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
            summary: `${input.request.providerId} editor-subagent session closed under coordinator-owned authority.`
        })
    ];
}
function createTeamEditorSubagentRoleEnvelope(input) {
    return {
        schemaId: 'atm.teamEditorSubagentRoleEnvelope.v1',
        taskId: input.request.taskId,
        role: input.request.role,
        providerId: input.request.providerId,
        sdkId: input.request.sdkId,
        modelId: input.request.modelId,
        runtimeMode: 'editor-subagent',
        executionSurface: input.executionSurface,
        allowedFiles: input.allowedFiles,
        permissionLeases: input.permissionLeases,
        coordinatorOwnedAuthority: true,
        brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked']
    };
}
export function assertEditorExecutionRequest(request, providerId) {
    if (request.providerId !== providerId) {
        throw new Error(`Expected providerId ${providerId}; received ${request.providerId}.`);
    }
    if (request.runtimeMode !== 'editor-subagent') {
        throw new Error(`${providerId} bridge requires runtimeMode editor-subagent for editor execution bridges.`);
    }
}
function normalizeString(value) {
    return String(value ?? '').trim();
}
function stableSessionId(taskId, role, providerId, modelId) {
    return `team-provider:${taskId}:${role}:${providerId}:${modelId}`;
}
function uniqueStrings(values) {
    return [...new Set(values)];
}
export function blockedCommandExecutionResult() {
    return {
        ok: false,
        outputText: '',
        retryable: false,
        summary: 'Execution blocked by Team permission broker.',
        executionMode: 'editor-cli'
    };
}
export function defaultCommandExecutor(input) {
    return new Promise((resolve) => {
        const child = spawn(input.command, [...input.args], {
            cwd: input.cwd,
            env: { ...process.env, ...input.env },
            shell: process.platform === 'win32',
            stdio: ['pipe', 'pipe', 'pipe']
        });
        let stdout = '';
        let stderr = '';
        const timeout = input.timeoutMs
            ? setTimeout(() => {
                child.kill();
                resolve({
                    ok: false,
                    outputText: stdout || stderr,
                    retryable: true,
                    summary: `Command ${input.command} timed out.`,
                    executionMode: 'editor-cli'
                });
            }, input.timeoutMs)
            : null;
        child.stdout?.on('data', (chunk) => { stdout += String(chunk); });
        child.stderr?.on('data', (chunk) => { stderr += String(chunk); });
        child.on('error', (error) => {
            if (timeout)
                clearTimeout(timeout);
            resolve({
                ok: false,
                outputText: error.message,
                retryable: false,
                summary: `Command ${input.command} could not be started.`,
                executionMode: 'editor-cli'
            });
        });
        child.on('close', (code) => {
            if (timeout)
                clearTimeout(timeout);
            resolve({
                ok: code === 0,
                statusCode: code ?? undefined,
                outputText: stdout || stderr,
                retryable: code !== 0,
                summary: code === 0 ? `Command ${input.command} completed.` : `Command ${input.command} exited with ${code}.`,
                executionMode: 'editor-cli'
            });
        });
        child.stdin?.end(input.stdin);
    });
}
function redactPreview(text) {
    return text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500);
}

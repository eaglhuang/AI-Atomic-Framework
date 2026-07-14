import { decideTeamPermission, type TeamPermissionPolicy } from '../permission-broker.ts';
import { createTeamObservabilityEvent, type TeamObservabilityEvent } from '../observability.ts';
import { spawn } from 'node:child_process';
import {
  type TeamProviderContract,
  type TeamProviderCommandExecutor,
  type TeamProviderExecutionResult,
  type TeamProviderId,
  type TeamProviderMetadata,
  type TeamProviderSessionRequest
} from '../provider-contract.ts';

export type TeamExecutionBridgeSurface = 'editor-subagent' | 'cli-style';

export type TeamEditorSubagentRoleEnvelope = {
  readonly schemaId: 'atm.teamEditorSubagentRoleEnvelope.v1';
  readonly taskId: string;
  readonly role: string;
  readonly providerId: TeamProviderId;
  readonly sdkId: string;
  readonly modelId: string;
  readonly runtimeMode: 'editor-subagent';
  readonly executionSurface: TeamExecutionBridgeSurface;
  readonly allowedFiles: readonly string[];
  readonly permissionLeases: readonly string[];
  readonly coordinatorOwnedAuthority: true;
  readonly brokerConflictVocabulary: readonly ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'];
};

export type TeamExecutionBridgeRunArtifact = {
  readonly schemaId: 'atm.teamProviderRunArtifact.v1';
  readonly specVersion: '0.1.0';
  readonly artifactType: 'atm.teamProviderRunArtifact.v1';
  readonly taskId: string;
  readonly role: string;
  readonly providerId: TeamProviderId;
  readonly sdkId: string;
  readonly modelId: string;
  readonly runtimeMode: 'editor-subagent';
  readonly sessionId: string;
  readonly roleEnvelope: TeamEditorSubagentRoleEnvelope;
  readonly permissionDecision: {
    readonly ok: boolean;
    readonly permission: string;
    readonly reason: string;
  };
  readonly outputArtifacts: readonly string[];
  readonly execution: {
    readonly mode: 'editor-cli';
    readonly statusCode?: number;
    readonly retryable: boolean;
    readonly outputTextPreview: string;
  };
  readonly billableUsage?: TeamProviderExecutionResult['billableUsage'];
  readonly observabilityEventCount: number;
  readonly redaction: {
    readonly rawSecretsLogged: false;
    readonly secretRefFields: readonly string[];
  };
};

export type TeamExecutionBridgeRunResult = {
  readonly schemaId: 'atm.teamProviderBridgeRunResult.v1';
  readonly ok: boolean;
  readonly providerId: TeamProviderId;
  readonly sessionId: string;
  readonly artifact: TeamExecutionBridgeRunArtifact;
  readonly observabilityEvents: readonly TeamObservabilityEvent[];
};

export type ClaudeCodeTeamProviderConfig = {
  readonly schemaId: 'atm.claudeCodeTeamProviderConfig.v1';
  readonly providerId: 'claude-code';
  readonly sdkId: 'claude-code-editor-subagent';
  readonly modelId: string;
  readonly editorCommand: string;
  readonly roleEnvelopeSchemaId: 'atm.teamEditorSubagentRoleEnvelope.v1';
};

export type ClaudeCodeTeamProviderConfigValidation = {
  readonly schemaId: 'atm.claudeCodeTeamProviderConfigValidation.v1';
  readonly providerId: 'claude-code';
  readonly ok: boolean;
  readonly missingFields: readonly string[];
  readonly requiredFields: readonly string[];
  readonly secretRefFields: readonly string[];
  readonly rawSecretsLogged: false;
};

export type ClaudeCodeTeamProviderBridge = TeamProviderContract & {
  readonly bridgeSchemaId: 'atm.claudeCodeTeamProviderBridge.v1';
  readonly config: ClaudeCodeTeamProviderConfig;
  readonly configValidation: ClaudeCodeTeamProviderConfigValidation;
  readonly secretRefFields: readonly string[];
  readonly executionSurface: 'editor-subagent';
};

const CLAUDE_CODE_REQUIRED_FIELDS = ['modelId', 'editorCommand', 'roleEnvelopeSchemaId'] as const;

export function validateClaudeCodeTeamProviderConfig(
  config: Partial<ClaudeCodeTeamProviderConfig>
): ClaudeCodeTeamProviderConfigValidation {
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

export function createClaudeCodeTeamProviderBridge(
  config: ClaudeCodeTeamProviderConfig
): ClaudeCodeTeamProviderBridge {
  const configValidation = validateClaudeCodeTeamProviderConfig(config);
  const metadata: TeamProviderMetadata = {
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

export async function launchClaudeCodeTeamProviderRun(input: {
  readonly bridge: ClaudeCodeTeamProviderBridge;
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'editor-subagent'; readonly providerId: 'claude-code' };
  readonly permissionPolicy: TeamPermissionPolicy;
  readonly scopedPaths: readonly string[];
  readonly permissionLeases?: readonly string[];
  readonly executor?: TeamProviderCommandExecutor;
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
  readonly emittedAt?: string;
}): Promise<TeamExecutionBridgeRunResult> {
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

export async function executeClaudeCodeCommand(input: {
  readonly config: ClaudeCodeTeamProviderConfig;
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'editor-subagent'; readonly providerId: 'claude-code' };
  readonly sessionId: string;
  readonly scopedPaths: readonly string[];
  readonly permissionLeases: readonly string[];
  readonly executor?: TeamProviderCommandExecutor;
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
}): Promise<TeamProviderExecutionResult> {
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
    executionSurface: 'editor-subagent' as const,
    supportedRuntimeModes: ['editor-subagent', 'broker-only'] as const,
    requiredConfigRefs: CLAUDE_CODE_REQUIRED_FIELDS,
    authModes: ['editor-session'] as const,
    executionReadiness: 'vendor-execution-ready' as const,
    brokerCheckedPermissions: ['exec.validator'] as const,
    artifactType: 'atm.teamProviderRunArtifact.v1',
    observabilityEventTypes: ['session.start', 'artifact.output', 'session.complete'] as const,
    sharedBrokerVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'] as const,
    rawSecretsLogged: false as const
  };
}

export function createTeamExecutionBridgeRunArtifact(input: {
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'editor-subagent' };
  readonly sessionId: string;
  readonly executionSurface: TeamExecutionBridgeSurface;
  readonly allowedFiles: readonly string[];
  readonly permissionLeases: readonly string[];
  readonly permissionDecision: { readonly ok: boolean; readonly permission: string; readonly reason: string };
  readonly secretRefFields: readonly string[];
  readonly execution: TeamProviderExecutionResult;
}): TeamExecutionBridgeRunArtifact {
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

export function createTeamExecutionBridgeObservabilityEvents(input: {
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'editor-subagent' };
  readonly artifact: TeamExecutionBridgeRunArtifact;
  readonly emittedAt?: string;
}): TeamObservabilityEvent[] {
  const common = {
    taskId: input.request.taskId,
    teamRunId: input.artifact.sessionId,
    providerId: input.request.providerId,
    role: input.request.role,
    runtimeMode: 'editor-subagent' as const,
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

function createTeamEditorSubagentRoleEnvelope(input: {
  readonly request: TeamProviderSessionRequest & { readonly runtimeMode: 'editor-subagent' };
  readonly executionSurface: TeamExecutionBridgeSurface;
  readonly allowedFiles: readonly string[];
  readonly permissionLeases: readonly string[];
}): TeamEditorSubagentRoleEnvelope {
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

export function assertEditorExecutionRequest(request: TeamProviderSessionRequest, providerId: TeamProviderId): void {
  if (request.providerId !== providerId) {
    throw new Error(`Expected providerId ${providerId}; received ${request.providerId}.`);
  }
  if (request.runtimeMode !== 'editor-subagent') {
    throw new Error(`${providerId} bridge requires runtimeMode editor-subagent for editor execution bridges.`);
  }
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim();
}

function stableSessionId(taskId: string, role: string, providerId: TeamProviderId, modelId: string): string {
  return `team-provider:${taskId}:${role}:${providerId}:${modelId}`;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function blockedCommandExecutionResult(): TeamProviderExecutionResult {
  return {
    ok: false,
    outputText: '',
    retryable: false,
    summary: 'Execution blocked by Team permission broker.',
    executionMode: 'editor-cli'
  };
}

export function defaultCommandExecutor(input: {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string | undefined>;
  readonly timeoutMs?: number;
  readonly stdin: string;
}): Promise<TeamProviderExecutionResult> {
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
      if (timeout) clearTimeout(timeout);
      resolve({
        ok: false,
        outputText: error.message,
        retryable: false,
        summary: `Command ${input.command} could not be started.`,
        executionMode: 'editor-cli'
      });
    });
    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
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

function redactPreview(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]').slice(0, 500);
}

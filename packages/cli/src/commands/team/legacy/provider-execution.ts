import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { CliError, readJsonFile } from '../../shared.ts';
import { createAnthropicTeamProviderBridge, launchAnthropicTeamProviderRun } from '../../../../../core/src/team-runtime/providers/anthropic.ts';
import { createGeminiDirectTeamProviderBridge, launchGeminiDirectTeamProviderRun } from '../../../../../core/src/team-runtime/providers/gemini-direct.ts';
import { createOpenAITeamProviderBridge, launchOpenAITeamProviderRun } from '../../../../../core/src/team-runtime/providers/openai.ts';
import { TEAM_PROVIDER_IDS, type TeamProviderHttpExecutor, type TeamProviderId } from '../../../../../core/src/team-runtime/provider-contract.ts';
import { createDefaultTeamPermissionPolicy } from '../../../../../core/src/team-runtime/permission-broker.ts';
import { materializeTeamRoleHandoff, verifyTeamHandoffLedger } from '../../../../../core/src/team-runtime/handoff-ledger.ts';
import { createTeamObservabilityEvent } from '../../../../../core/src/team-runtime/observability.ts';
import { runProviderOrchestration } from '../../../../../core/src/team-runtime/execution-orchestrator.ts';
import type {
  TeamRecipe,
  TeamRuntimeContract,
  TeamRuntimeMode,
  TeamRuntimePilot,
  TeamVendorLocalSecrets,
  TeamVendorLocalSecretsSummary
} from './types.ts';
import { teamRunsDirectory } from './team-run-store.ts';

export type DirectTeamRoleHandoffArtifact = {
  readonly role: string;
  readonly providerId: string;
  readonly outputTextPreview: string;
};

type DirectTeamProviderRoleResult = Awaited<ReturnType<typeof runProviderOrchestration>> & {
  readonly handoffArtifact: DirectTeamRoleHandoffArtifact;
  readonly contextTelemetry: {
    readonly baseInstructionChars: number;
    readonly handoffChars: number;
    readonly totalInstructionChars: number;
    readonly actualTokenCount: number;
    readonly tokenEstimatorId: 'whitespace-v1';
    readonly priorArtifactCount: number;
    readonly consumedArtifactRefs: readonly string[];
  };
};

export const TEAM_HANDOFF_CONTEXT_PER_ARTIFACT_TOKENS = 256;
export const TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS = 4;
export const TEAM_HANDOFF_CONTEXT_TOTAL_TOKENS = 1024;

export async function runTeamProviderExecution(input: {
  cwd: string;
  taskId: string;
  teamRunId: string;
  recipe: TeamRecipe;
  runtimeContract: TeamRuntimeContract;
  runtimePilot: TeamRuntimePilot;
  roleSelections: readonly {
    role: string;
    selectedProvider: {
      providerId: string;
      sdkId: string;
      modelId: string;
      runtimeMode: TeamRuntimeMode;
    };
  }[];
  scopedPaths: readonly string[];
  executor?: TeamProviderHttpExecutor;
}) {
  if (input.runtimeContract.runtimeMode === 'broker-only') {
    return {
      requested: true,
      blockedReason: 'broker-only-runtime-never-spawns',
      results: [] as DirectTeamProviderRoleResult[]
    };
  }
  const selectedRoles = input.roleSelections.length > 0
    ? input.roleSelections
    : input.recipe.agents.map((agent) => ({
      role: agent.role,
      selectedProvider: {
        providerId: input.runtimeContract.providerId ?? '',
        sdkId: input.runtimeContract.sdkId ?? 'unknown-sdk',
        modelId: input.runtimeContract.modelId ?? 'unknown-model',
        runtimeMode: input.runtimeContract.runtimeMode
      }
    }));
  const localSecrets = loadTeamVendorLocalSecrets(input.cwd);
  const results: DirectTeamProviderRoleResult[] = [];
  const priorRoleArtifacts: DirectTeamRoleHandoffArtifact[] = [];
  const handoffEvents: ReturnType<typeof createTeamObservabilityEvent>[] = [];
  for (const [roleIndex, roleSelection] of selectedRoles.entries()) {
    const result = await runDirectTeamProviderRole({
      taskId: input.taskId,
      role: roleSelection.role,
      selection: roleSelection.selectedProvider,
      env: localSecrets.env,
      scopedPaths: input.scopedPaths,
      priorRoleArtifacts,
      executor: input.executor
    });
    if (result) {
      results.push(result);
      if (result.handoffArtifact && result.ok) {
        const next = selectedRoles[roleIndex + 1];
        const materialized = materializeTeamRoleHandoff({
          cwd: input.cwd,
          taskId: input.taskId,
          teamRunId: input.teamRunId,
          fromRole: result.handoffArtifact.role,
          fromProviderId: result.handoffArtifact.providerId,
          fromModelId: roleSelection.selectedProvider.modelId,
          toRole: next?.role ?? 'coordinator',
          toProviderId: next?.selectedProvider.providerId ?? null,
          sourceArtifactId: result.sessionId,
          redactedPreview: result.handoffArtifact.outputTextPreview,
          leaseEpoch: roleIndex + 1
        });
        const integrity = verifyTeamHandoffLedger(input.cwd, input.taskId, input.teamRunId);
        if (!integrity.ok) {
          throw new CliError('ATM_TEAM_HANDOFF_INTEGRITY_BLOCKED', `Team handoff integrity check failed: ${integrity.reason}.`, { exitCode: 1 });
        }
        priorRoleArtifacts.push({
          role: materialized.artifact.from.role,
          providerId: materialized.artifact.from.providerId,
          outputTextPreview: materialized.artifact.humanSummary
        });
        handoffEvents.push(createTeamObservabilityEvent({
          eventType: 'handoff.materialized',
          taskId: input.taskId,
          teamRunId: input.teamRunId,
          providerId: normalizeTeamProviderId(materialized.artifact.from.providerId) ?? 'unknown',
          role: materialized.artifact.from.role,
          runtimeMode: input.runtimeContract.runtimeMode,
          artifactType: materialized.artifact.schemaId,
          artifactId: materialized.artifact.handoffId,
          decisionClass: materialized.artifact.decision.decisionClass,
          decisionReason: materialized.artifact.decision.decisionReason,
          violationStatus: materialized.artifact.decision.violationStatus,
          summary: `Handoff ${materialized.artifact.handoffId} materialized.`
        }));
      }
    }
  }
  appendTeamRuntimeObservabilityEvents(input.cwd, input.teamRunId, results.flatMap((result) => buildProviderOrchestrationEvents({
    taskId: input.taskId,
    teamRunId: input.teamRunId,
    runtimeMode: input.runtimeContract.runtimeMode,
    result
  })).concat(handoffEvents));
  return {
    requested: true,
    blockedReason: null,
    localSecrets: localSecrets.summary,
    results
  };
}

export function buildDirectTeamRoleInstructions(input: {
  taskId: string;
  role: string;
  priorRoleArtifacts?: readonly DirectTeamRoleHandoffArtifact[];
}): { instructions: string; telemetry: DirectTeamProviderRoleResult['contextTelemetry'] } {
  const base = `Run Team role ${input.role} for ${input.taskId}. Return a concise role report. Do not close, commit, or exceed Coordinator authority.`;
  const bounded = (input.priorRoleArtifacts ?? []).slice(-TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS).map((artifact) => ({
    ...artifact,
    outputTextPreview: truncateTokenBudget(artifact.outputTextPreview, TEAM_HANDOFF_CONTEXT_PER_ARTIFACT_TOKENS)
  }));
  const handoff = bounded.length === 0 ? '' : `\nPrior governed role artifacts (review and cite relevant source roles):\n${truncateTokenBudget(bounded.map((artifact) => `[${artifact.role}/${artifact.providerId}] ${artifact.outputTextPreview}`).join('\n'), TEAM_HANDOFF_CONTEXT_TOTAL_TOKENS)}`;
  return {
    instructions: `${base}${handoff}`,
    telemetry: {
      baseInstructionChars: base.length,
      handoffChars: handoff.length,
      totalInstructionChars: base.length + handoff.length,
      actualTokenCount: estimateTokens(base) + estimateTokens(handoff),
      tokenEstimatorId: 'whitespace-v1',
      priorArtifactCount: bounded.length,
      consumedArtifactRefs: bounded.map((artifact) => `${artifact.role}/${artifact.providerId}`)
    }
  };
}

function estimateTokens(value: string): number { return value.trim() ? value.trim().split(/\s+/).length : 0; }
function truncateTokenBudget(value: string, budget: number): string { return value.trim().split(/\s+/).slice(0, budget).join(' '); }

export async function runDirectTeamProviderRole(input: {
  taskId: string;
  role: string;
  selection: {
    providerId: string;
    sdkId: string;
    modelId: string;
    runtimeMode: TeamRuntimeMode;
  };
  env: Record<string, string | undefined>;
  scopedPaths: readonly string[];
  priorRoleArtifacts?: readonly DirectTeamRoleHandoffArtifact[];
  executor?: TeamProviderHttpExecutor;
}): Promise<DirectTeamProviderRoleResult | null> {
  if (input.selection.runtimeMode !== 'real-agent') return null;
  const providerId = normalizeTeamProviderId(input.selection.providerId);
  if (providerId !== 'openai' && providerId !== 'anthropic' && providerId !== 'gemini-direct') return null;
  const rolePrompt = buildDirectTeamRoleInstructions(input);
  const request = {
    taskId: input.taskId,
    role: input.role,
    runtimeMode: 'real-agent' as const,
    providerId,
    sdkId: input.selection.sdkId,
    modelId: input.selection.modelId,
    instructions: rolePrompt.instructions
  };
  const permissionPolicy = createDefaultTeamPermissionPolicy();
  const bridgeResult = providerId === 'openai'
    ? await launchOpenAITeamProviderRun({
      bridge: createOpenAITeamProviderBridge({
        schemaId: 'atm.openaiTeamProviderConfig.v1',
        providerId: 'openai',
        sdkId: 'openai-responses',
        modelId: input.selection.modelId,
        apiKeyEnvVar: 'OPENAI_API_KEY'
      }),
      request: { ...request, providerId: 'openai' },
      permissionPolicy,
      scopedPaths: input.scopedPaths,
      env: input.env,
      executor: input.executor
    })
    : providerId === 'anthropic' ? await launchAnthropicTeamProviderRun({
      bridge: createAnthropicTeamProviderBridge({
        schemaId: 'atm.anthropicTeamProviderConfig.v1',
        providerId: 'anthropic',
        sdkId: 'anthropic-messages',
        modelId: input.selection.modelId,
        apiKeyEnvVar: 'ANTHROPIC_API_KEY'
      }),
      request: { ...request, providerId: 'anthropic' },
      permissionPolicy,
      scopedPaths: input.scopedPaths,
      env: input.env,
      executor: input.executor
    }) : await launchGeminiDirectTeamProviderRun({
      bridge: createGeminiDirectTeamProviderBridge({
        schemaId: 'atm.geminiDirectTeamProviderConfig.v1',
        providerId: 'gemini-direct',
        sdkId: 'gemini-generate-content',
        modelId: input.selection.modelId,
        apiKeyEnvVar: 'GEMINI_API_KEY'
      }),
      request: { ...request, providerId: 'gemini-direct' },
      permissionPolicy,
      scopedPaths: input.scopedPaths,
      env: input.env,
      executor: input.executor
    });
  return {
    ok: bridgeResult.ok,
    attempts: 1,
    sessionId: bridgeResult.sessionId,
    providerId: bridgeResult.providerId,
    coordinatorOwnedAuthority: true,
    stepResult: {
      ok: bridgeResult.ok,
      providerId: bridgeResult.providerId,
      role: input.role,
      artifacts: [bridgeResult.artifact.artifactType, ...bridgeResult.artifact.outputArtifacts],
      retryable: bridgeResult.artifact.execution.retryable,
      summary: `${bridgeResult.providerId} ${input.role} vendor execution ${bridgeResult.ok ? 'completed' : 'failed'}${bridgeResult.artifact.execution.statusCode ? ` with status ${bridgeResult.artifact.execution.statusCode}` : ''}.`
    },
    handoffArtifact: {
      role: input.role,
      providerId: bridgeResult.providerId,
      outputTextPreview: bridgeResult.artifact.execution.outputTextPreview
    },
    contextTelemetry: rolePrompt.telemetry
  };
}

export function loadTeamVendorLocalSecrets(cwd: string): {
  env: Record<string, string | undefined>;
  summary: TeamVendorLocalSecretsSummary;
} {
  const relativePath = 'agent-integrations/vendors/team-secrets.local.json';
  const secretPath = path.join(cwd, ...relativePath.split('/'));
  const warnings: string[] = [];
  const env: Record<string, string | undefined> = {};
  const secretRefs = new Set<string>();
  let providerCount = 0;
  if (existsSync(secretPath)) {
    const parsed = readJsonFile(secretPath, 'ATM_TEAM_VENDOR_SECRETS_INVALID') as Partial<TeamVendorLocalSecrets>;
    if (parsed.schemaId !== 'atm.teamVendorSecrets.local.v1') {
      throw new CliError('ATM_TEAM_VENDOR_SECRETS_INVALID', 'Team vendor local secrets must use schemaId atm.teamVendorSecrets.local.v1.', {
        exitCode: 2,
        details: { path: relativePath }
      });
    }
    const providerEntries = parsed.providers && typeof parsed.providers === 'object'
      ? Object.entries(parsed.providers)
      : [];
    providerCount = providerEntries.length;
    for (const [providerId, refs] of providerEntries) {
      if (!refs || typeof refs !== 'object' || Array.isArray(refs)) {
        warnings.push(`Provider ${providerId} does not contain a key/value object.`);
        continue;
      }
      for (const [envName, value] of Object.entries(refs)) {
        collectTeamVendorSecret(env, secretRefs, warnings, envName, value, `providers.${providerId}`);
      }
    }
    for (const [envName, value] of Object.entries(parsed.env ?? {})) {
      collectTeamVendorSecret(env, secretRefs, warnings, envName, value, 'env');
    }
  }
  return {
    env,
    summary: {
      schemaId: 'atm.teamVendorLocalSecretsSummary.v1',
      path: relativePath,
      loaded: existsSync(secretPath),
      providerCount,
      secretRefCount: secretRefs.size,
      secretRefs: [...secretRefs].sort(),
      warningCount: warnings.length,
      warnings,
      rawSecretsLogged: false
    }
  };
}

function collectTeamVendorSecret(
  env: Record<string, string | undefined>,
  secretRefs: Set<string>,
  warnings: string[],
  envName: string,
  value: unknown,
  source: string
) {
  const normalizedEnvName = String(envName ?? '').trim();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(normalizedEnvName)) {
    warnings.push(`Ignored invalid environment variable name ${source}.${envName}.`);
    return;
  }
  if (typeof value !== 'string' || value.length === 0) {
    warnings.push(`Ignored empty or non-string secret value for ${normalizedEnvName}.`);
    return;
  }
  env[normalizedEnvName] = value;
  secretRefs.add(normalizedEnvName);
}

function buildProviderOrchestrationEvents(input: {
  taskId: string;
  teamRunId: string;
  runtimeMode: TeamRuntimeMode;
  result: Awaited<ReturnType<typeof runProviderOrchestration>>;
}) {
  const role = String(input.result.stepResult.role ?? 'worker');
  const providerId = normalizeTeamProviderId(input.result.providerId) ?? 'unknown';
  const conflictBlocked = input.result.stepResult.artifacts.includes('atm.brokerConflictResolution.v1')
    || input.result.stepResult.summary.includes('broker-conflict-blocked');
  return [
    createTeamObservabilityEvent({
      eventType: 'session.start',
      taskId: input.taskId,
      teamRunId: input.teamRunId,
      providerId,
      role,
      runtimeMode: input.runtimeMode,
      summary: `Provider session started: ${input.result.sessionId}.`
    }),
    createTeamObservabilityEvent({
      eventType: input.result.ok ? 'step.execution' : 'session.failure',
      taskId: input.taskId,
      teamRunId: input.teamRunId,
      providerId,
      role,
      runtimeMode: input.runtimeMode,
      decisionClass: input.result.ok ? 'auto-execution' : 'blocked',
      decisionReason: input.result.stepResult.summary,
      violationStatus: conflictBlocked ? 'broker-conflict-blocked' : input.result.ok ? 'none' : 'blocked',
      statusCode: conflictBlocked ? 'broker-conflict-blocked' : input.result.ok ? 'none' : 'provider-step-failed',
      summary: input.result.stepResult.summary
    }),
    ...input.result.stepResult.artifacts.map((artifactType) => createTeamObservabilityEvent({
      eventType: artifactType === 'atm.brokerConflictResolution.v1' || conflictBlocked ? 'broker.conflict.blocked' : 'artifact.output',
      taskId: input.taskId,
      teamRunId: input.teamRunId,
      providerId,
      role,
      runtimeMode: input.runtimeMode,
      artifactType,
      artifactId: `${input.result.sessionId}:${artifactType}`,
      decisionClass: conflictBlocked ? 'blocked' : input.result.ok ? 'auto-execution' : 'blocked',
      decisionReason: input.result.stepResult.summary,
      violationStatus: conflictBlocked ? 'broker-conflict-blocked' : input.result.ok ? 'none' : 'blocked',
      statusCode: conflictBlocked ? 'broker-conflict-blocked' : input.result.ok ? 'none' : 'provider-step-failed',
      summary: `${artifactType} emitted by ${role}.`
    })),
    createTeamObservabilityEvent({
      eventType: input.result.ok ? 'session.complete' : 'session.failure',
      taskId: input.taskId,
      teamRunId: input.teamRunId,
      providerId,
      role,
      runtimeMode: input.runtimeMode,
      decisionClass: input.result.ok ? 'auto-execution' : 'blocked',
      decisionReason: input.result.stepResult.summary,
      violationStatus: conflictBlocked ? 'broker-conflict-blocked' : input.result.ok ? 'none' : 'blocked',
      statusCode: conflictBlocked ? 'broker-conflict-blocked' : input.result.ok ? 'none' : 'provider-step-failed',
      summary: input.result.ok ? `Provider session completed: ${input.result.sessionId}.` : `Provider session failed: ${input.result.sessionId}.`
    })
  ];
}

export function appendTeamRuntimeObservabilityEvents(cwd: string, teamRunId: string, events: ReturnType<typeof createTeamObservabilityEvent>[]) {
  if (events.length === 0) return;
  const runDir = path.join(teamRunsDirectory(cwd), teamRunId);
  mkdirSync(runDir, { recursive: true });
  const jsonlPath = path.join(runDir, 'observability-events.jsonl');
  appendFileSync(jsonlPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
}

function normalizeTeamProviderId(value: unknown): TeamProviderId | null {
  const normalized = String(value ?? '').trim();
  return (TEAM_PROVIDER_IDS as readonly string[]).includes(normalized) ? normalized as TeamProviderId : null;
}

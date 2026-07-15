import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CliError,
  makeResult,
  message,
  parseArgsForCommand,
  quoteCliValue,
  readJsonFile,
  writeJsonFile
} from './shared.ts';
import {
  TEAM_CLOSURE_ATTESTATION_SCHEMA_ID,
  type TeamClosureAttestationEvidence,
  type TeamClosureReviewerIndependenceEvidence
} from './evidence.ts';
import { getCommandSpec } from './command-specs.ts';
import { inspectTeamRuntimeBackendCapabilities } from './integration.ts';
import { runTasks } from './tasks.ts';
import { evaluateBrokerQueueAdmission, restrictTeamWriteScopeForQueueAdmission } from './next/broker-queue-admission.ts';
import { findTaskClaimDependencyBlockers } from './tasks/dependency-gates.ts';
import { validateStrictPathHeuristic } from './tasks/task-import-validators.ts';
import { buildTeamKnowledgeSummary, runTeamKnowledge, type TeamKnowledgeSummary } from './team-knowledge.ts';
import { runTeamWave } from './team-wave.ts';
import {
  buildTeamBrokerEvidence,
  brokerLaneToFindings,
  evaluateTeamBrokerLane,
  type TeamBrokerLaneEvidence
} from '../../../core/src/broker/team-lane.ts';
import {
  resolveNodejsTeamWorkerAdapter,
  type TeamWorkerAdapterContract
} from '../../../core/src/team-runtime/nodejs-worker-adapter.ts';
import {
  createBrokerConflictResolutionArtifact,
  type BrokerConflictDecisionClass,
  type BrokerConflictViolationStatus
} from '../../../core/src/team-runtime/permission-broker.ts';
import {
  buildTeamObservabilityContract,
  createBrokerConflictObservabilityEvents,
  createTeamObservabilityEvent,
  queryTeamObservabilityEvents
} from '../../../core/src/team-runtime/observability.ts';
import { createTeamProviderContract } from '../../../core/src/team-runtime/provider-contract.ts';
import { readTeamHandoffArtifacts, renderTeamHandoffIndex, teamHandoffHistoryDirectory, teamHandoffRuntimeDirectory, verifyTeamHandoffHistory, verifyTeamHandoffLedger } from '../../../core/src/team-runtime/handoff-ledger.ts';
import {
  type TeamProviderSelectionConfig,
  type TeamRoleProviderOverride
} from '../../../core/src/team-runtime/provider-selection.ts';
import { readBrokerProposalFile, validateBrokerProposal } from '../../../core/src/broker/proposal.ts';
import { planSharedSurfaceAcquisition, type SharedSurfaceQueue } from '../../../core/src/broker/shared-surface-queue.ts';
import { inspectGitIndexOwnership, type GitIndexOwnershipReport } from './git-index-ownership.ts';
import { loadTeamProviderSelectionConfigFromRepo, resolveTeamRuntimeProviderSelection } from './team/role-provider-resolution.ts';
import {
  buildTeamGrowthContract,
  buildTeamRoleGrowthObservabilityContract,
  type TeamGrowthContract,
  type TeamRoleGrowthObservabilityContract
} from './team/growth-contract.ts';
import {
  buildProviderNeutralRoleSkillPackManifest,
  buildTeamRoleRoutingMatrix,
  buildTeamRoleSkillPackContract,
  type TeamRoleRoutingMatrix,
  type TeamRoleSkillPackContract,
  type TeamRoleSkillPackManifest
} from './team/role-skill-packs.ts';
import {
  buildAnthropicRuntimeBridgeSummary,
  buildEditorExecutionRuntimeBridgeSummary,
  buildMicrosoftFoundryRuntimeBridgeSummary,
  buildOpenAIFamilyRuntimeBridgeSummary
} from './team/runtime-bridges.ts';
import { buildRuntimeTierContract } from './team/runtime-tier-contract.ts';
import { buildTeamShadowScheduleForPlan } from './team/shadow-plan.ts';
import { composeTeamContributionManifests } from './team/composer.ts';
import { resolveTeamStartExecutionLane, runtimeBackendAdmissionForTeam } from './team/team-execution-lane.ts';
import { resolveTeamActionRoute, resolveTeamFastPath, supportedTeamActionList } from './team/team-route-map.ts';
import {
  buildTeamArtifactHandoffContract,
  buildTeamRetryBudgetContract,
  buildTeamReworkRouteStateMachine,
  buildTeamRoleArtifactContract,
  transitionTeamReworkRoute,
  validateTeamArtifactHandoff
} from './team/legacy/runtime-contracts.ts';
import {
  buildTeamPatrolFollowUp,
  buildTeamRunPatrolFindings,
  summarizePatrolSeverity,
  suggestedPatrolCommand,
  teamPatrolFinding
} from './team/legacy/patrol-contracts.ts';
import {
  buildPermissionFinding,
  buildProposalFirstParityFindings,
  buildSuggestedPermissionLeases,
  deriveAllowedWriteScope,
  mergeValidation,
  normalizeRepoAbsoluteLeasePath,
  normalizeTeamLeasePath,
  normalizeTaskWriteScope,
  validateTeamPermissionModel
} from './team/legacy/permission-lease-policy.ts';
import {
  buildTeamLeaseConflictDetails,
  buildTeamLeaseNotFoundDetails,
  compactTeamRun,
  createTeamRunId,
  findLatestTeamRunForTask,
  listTeamRuns,
  normalizePermissionLeaseRecords,
  readTeamRun,
  teamRunsDirectory,
  writeExistingTeamRun
} from './team/legacy/team-run-store.ts';
import {
  TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS,
  appendTeamRuntimeObservabilityEvents,
  buildDirectTeamRoleInstructions,
  loadTeamVendorLocalSecrets,
  runDirectTeamProviderRole,
  runTeamProviderExecution,
  type DirectTeamRoleHandoffArtifact
} from './team/legacy/provider-execution.ts';
export {
  buildTeamGrowthContract,
  buildTeamRoleGrowthObservabilityContract,
  type TeamGrowthContract,
  type TeamRoleGrowthObservabilityContract
} from './team/growth-contract.ts';
export {
  buildProviderNeutralRoleSkillPackManifest,
  buildTeamRoleRoutingMatrix,
  buildTeamRoleSkillPackContract,
  type TeamRoleRoutingMatrix,
  type TeamRoleSkillPackContract,
  type TeamRoleSkillPackManifest
} from './team/role-skill-packs.ts';
export {
  buildAnthropicRuntimeBridgeSummary,
  buildEditorExecutionRuntimeBridgeSummary,
  buildGeminiDirectRuntimeBridgeSummary,
  buildMicrosoftFoundryRuntimeBridgeSummary,
  buildOpenAIFamilyRuntimeBridgeSummary
} from './team/runtime-bridges.ts';
export {
  buildTeamArtifactHandoffContract,
  buildTeamRetryBudgetContract,
  buildTeamReworkRouteStateMachine,
  transitionTeamReworkRoute,
  validateTeamArtifactHandoff
} from './team/legacy/runtime-contracts.ts';
export {
  buildTeamLeaseConflictDetails,
  buildTeamLeaseNotFoundDetails,
  compactTeamRun,
  createTeamRunId,
  findLatestTeamRunForTask,
  listTeamRuns,
  normalizePermissionLeaseRecords,
  readTeamRun,
  teamRunsDirectory,
  writeExistingTeamRun
} from './team/legacy/team-run-store.ts';
export {
  buildPermissionFinding,
  buildProposalFirstParityFindings,
  buildSuggestedPermissionLeases,
  deriveAllowedWriteScope,
  mergeValidation,
  normalizeRepoAbsoluteLeasePath,
  normalizeTeamLeasePath,
  normalizeTaskWriteScope,
  validateTeamPermissionModel
} from './team/legacy/permission-lease-policy.ts';
export {
  TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS,
  appendTeamRuntimeObservabilityEvents,
  buildDirectTeamRoleInstructions,
  loadTeamVendorLocalSecrets,
  runDirectTeamProviderRole,
  runTeamProviderExecution,
  type DirectTeamRoleHandoffArtifact
} from './team/legacy/provider-execution.ts';

import {
  TEAM_ATOM_BOUNDARIES,
  atomizationPlanningThreshold,
  atomizationRiskHotFiles,
  teamPermissionCatalog,
  type BatchTeamAdmissionDecision,
  type PermissionFinding,
  type PermissionLease,
  type ReviewerIdentity,
  type TeamArtifactHandoffContract,
  type TeamArtifactHandoffFinding,
  type TeamBrokerSubagentContract,
  type TeamClosureAttestationInput,
  type TeamCommitLaneContract,
  type TeamCrewRole,
  type TeamEditorSubagentBridgeContract,
  type TeamEditorSubagentRoleEnvelope,
  type TeamGovernanceRuntimeFields,
  type TeamImplementerSelector,
  type TeamLevel,
  type TeamLifecycleAction,
  type TeamPatrolFinding,
  type TeamPatrolMode,
  type TeamPermissionLeaseSummary,
  type TeamPermissionValidationOptions,
  type TeamRecipe,
  type TeamRecipeAgent,
  type TeamRecommendation,
  type TeamRecommendationChannel,
  type TeamRetryBudgetContract,
  type TeamReworkFinding,
  type TeamReworkRoute,
  type TeamReworkRouteStatus,
  type TeamReworkTransition,
  type TeamRoleArtifactContract,
  type TeamRuntimeContract,
  type TeamRuntimeMode,
  type TeamRuntimePilot
} from './team/legacy/types.ts';
export { TEAM_ATOM_BOUNDARIES };
export type {
  BatchTeamAdmissionDecision,
  PermissionLease,
  TeamPermissionLeaseSummary,
  TeamRecommendation,
  TeamRecommendationChannel
};

export function evaluateBatchTeamAdmission(input: {
  readonly taskId: string;
  readonly batchId: string;
  readonly currentQueueHeadTaskId: string | null | undefined;
  readonly structuralParallelism: boolean;
  readonly costTelemetryLoaded?: boolean;
  readonly stopLossTriggered?: boolean;
}): BatchTeamAdmissionDecision {
  const taskId = String(input.taskId ?? '').trim();
  const batchId = String(input.batchId ?? '').trim();
  const isQueueHead = taskId.length > 0 && taskId === String(input.currentQueueHeadTaskId ?? '').trim();
  const costTelemetryLoaded = input.costTelemetryLoaded === true;
  const reasonCodes: string[] = [];
  if (!isQueueHead) reasonCodes.push('not-current-queue-head');
  if (input.structuralParallelism !== true) reasonCodes.push('no-structural-parallelism');
  if (!costTelemetryLoaded) reasonCodes.push('missing-cost-telemetry');
  if (input.stopLossTriggered === true) reasonCodes.push('stop-loss-triggered');
  const allowed = reasonCodes.length === 0;
  return {
    schemaId: 'atm.batchTeamAdmissionDecision.v1',
    taskId,
    batchId,
    allowed,
    mode: allowed ? 'team-current-head' : 'single-agent',
    reasonCodes,
    queueHeadOnly: true,
    structuralParallelismRequired: true,
    costTelemetryRequired: true,
    stopLossAction: input.stopLossTriggered === true
      ? 'single-agent'
      : (!costTelemetryLoaded ? 'cheaper-qualified-model-mix' : 'none')
  };
}

export function resolveTeamRecipeIdForChannel(channel: TeamRecommendationChannel): string {
  if (channel === 'batch') {
    return 'atm.default.batch';
  }
  if (channel === 'fast') {
    return 'atm.default.fast';
  }
  return 'atm.default.normal.typescript';
}

export function defaultTeamRecommendationReason(channel: TeamRecommendationChannel): string {
  if (channel === 'batch') {
    return 'Batch queue-head work can use a current-task team, but ATM still owns checkpoint and advance.';
  }
  if (channel === 'fast') {
    return 'Fast quickfix work usually stays single-actor; a team run is optional and advisory only.';
  }
  return 'This task can use an optional team run for role and permission coordination.';
}

export function buildTeamRecommendation(input: {
  readonly taskId: string | null | undefined;
  readonly actorId?: string;
  readonly channel: TeamRecommendationChannel;
  readonly reason?: string;
  readonly enabled?: boolean;
  readonly knowledgeSummary?: TeamKnowledgeSummary;
  readonly parallelAdvisory?: unknown;
}): TeamRecommendation | null {
  const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
  if (!taskId || input.enabled === false) {
    return null;
  }
  const actorId = input.actorId?.trim() || '<id>';
  const recipeId = resolveTeamRecipeIdForChannel(input.channel);
  const quotedTask = quoteCliValue(taskId);
  const reason = input.reason?.trim() || defaultTeamRecommendationReason(input.channel);
  return {
    schemaId: 'atm.teamRecommendation.v1',
    enabled: true,
    required: false,
    channel: input.channel,
    taskId,
    recipeId,
    reason,
    plan: `node atm.mjs team plan --task ${quotedTask} --recipe ${recipeId} --json`,
    validate: `node atm.mjs team validate --task ${quotedTask} --recipe ${recipeId} --json`,
    start: `node atm.mjs team start --task ${quotedTask} --actor ${actorId} --recipe ${recipeId} --json`,
    status: 'node atm.mjs team status --compact --json',
    ...(input.knowledgeSummary ? { knowledgeSummary: input.knowledgeSummary } : {}),
    ...(input.parallelAdvisory ? { parallelAdvisory: input.parallelAdvisory } : {}),
    constraints: [
      'Team start writes only .atm/runtime/team-runs/<teamRunId>.json.',
      'Team agents are not spawned by this recommendation.',
      'Coordinator remains the only task.lifecycle and git.write owner.'
    ]
  };
}

const builtInRecipes: TeamRecipe[] = [
  {
    schemaId: 'atm.teamRecipe.v1',
    recipeId: 'atm.default.fast',
    appliesTo: ['fast'],
    agents: [
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'file.write', 'handoff.read', 'handoff.materialize'] },
      { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
      { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
    ]
  },
  {
    schemaId: 'atm.teamRecipe.v1',
    recipeId: 'atm.default.normal.typescript',
    appliesTo: ['normal'],
    language: 'typescript',
    agents: [
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'handoff.read', 'handoff.materialize'] },
      { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
      { agentId: 'reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
      { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
      { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
      { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
    ]
  },
  {
    schemaId: 'atm.teamRecipe.v1',
    recipeId: 'atm.default.batch',
    appliesTo: ['batch'],
    agents: [
      { agentId: 'batch-coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'handoff.read', 'handoff.materialize'] },
      { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
      { agentId: 'current-task-reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
      { agentId: 'current-task-scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
      { agentId: 'current-task-implementer', role: 'implementer', profile: 'atm.implementer.generic.v1', permissions: ['file.write'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
      { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
    ]
  }
];

const teamRosterLevelRoles: Record<TeamLevel, string[]> = {
  L1: ['coordinator', 'atomizationPlanner', 'implementer', 'validator'],
  L2: ['coordinator', 'atomizationPlanner', 'reader', 'implementer', 'validator', 'evidenceCollector'],
  L3: ['coordinator', 'atomizationPlanner', 'reader', 'scopeGuardian', 'implementer', 'validator', 'evidenceCollector'],
  L4: ['coordinator', 'atomizationPlanner', 'reader', 'scopeGuardian', 'implementer', 'validator', 'evidenceCollector', 'lieutenant'],
  L5: ['coordinator', 'atomizationPlanner', 'reader', 'scopeGuardian', 'implementer', 'validator', 'evidenceCollector', 'lieutenant', 'reviewAgent', 'knowledgeScout']
};

const teamRosterSyntheticAgents: Record<string, TeamRecipeAgent> = {
  lieutenant: { agentId: 'lieutenant', role: 'lieutenant', profile: 'atm.lieutenant.v1', permissions: ['file.read', 'exec.validator'] },
  reviewAgent: { agentId: 'review-agent', role: 'reviewAgent', profile: 'atm.reviewAgent.v1', permissions: ['file.read', 'exec.validator'] },
  knowledgeScout: { agentId: 'knowledge-scout', role: 'knowledgeScout', profile: 'atm.knowledgeScout.v1', permissions: ['file.read'] }
};

const catalogReadyRosterDeferredRoles = [
  'dataPipelineAgent',
  'dbContainerAgent',
  'ciAgent',
  'webResearchAgent',
  'qaLead',
  'closureSteward'
];

export async function runTeam(argv: string[]) {
  const fastPath = resolveTeamFastPath(argv);
  if (fastPath) {
    const cwd = fastPath.cwdSource === 'process'
      ? process.cwd()
      : path.resolve(readOptionValue(argv, '--cwd') ?? process.cwd());
    if (fastPath.fastPath === 'handoff') return runTeamHandoff(fastPath.argv, cwd);
    if (fastPath.fastPath === 'knowledge') return runTeamKnowledge(fastPath.argv, cwd);
    if (fastPath.fastPath === 'broker') return runTeamBroker(fastPath.argv, cwd);
    return runTeamObservability(fastPath.argv, cwd);
  }

  const spec = getCommandSpec('team')!;
  const parsed = parseArgsForCommand(spec, argv);
  const action = String(parsed.positional[0] ?? 'plan').toLowerCase();
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));
  const route = resolveTeamActionRoute(action, parsed.positional.slice(1));

  if (route.kind === 'special-action' && route.action === 'wave') {
    // TASK-MAO-0024: Team Agents Wave Mode planning surface.
    return runTeamWave(route.argv, cwd);
  }

  if (route.kind === 'special-action' && route.action === 'knowledge') {
    const knowledgeArgv = argv[0]?.toLowerCase() === 'knowledge' ? argv.slice(1) : parsed.positional.slice(1).map(String);
    return runTeamKnowledge(knowledgeArgv, cwd);
  }

  if (route.kind === 'special-action' && route.action === 'broker') {
    return runTeamBroker(route.argv, cwd);
  }

  if (route.kind === 'special-action' && route.action === 'observability') {
    return runTeamObservability(route.argv, cwd);
  }

  if (route.kind === 'planning' && route.action === 'plan' && action !== 'plan') {
    throw new CliError('ATM_CLI_USAGE', `team supports: ${supportedTeamActionList()}`, { exitCode: 2 });
  }

  if (route.kind === 'status') {
    return buildTeamStatusResult({
      cwd,
      requestedTeamRunId: String(parsed.options.team ?? '').trim(),
      compact: Boolean(parsed.options.compact)
    });
  }

  if (route.kind === 'lifecycle') {
    return runTeamLifecycleAction({
      cwd,
      action: route.action as TeamLifecycleAction,
      teamRunId: String(parsed.options.team ?? '').trim(),
      actorId: String(parsed.options.actor ?? '').trim(),
      permission: String(parsed.options.permission ?? '').trim(),
      paths: normalizeTeamLifecyclePaths(parsed.options.paths),
      reason: String(parsed.options.reason ?? '').trim()
    });
  }

  const taskId = String(parsed.options.task ?? '').trim();
  if (!taskId) {
    throw new CliError('ATM_TEAM_TASK_REQUIRED', `team ${route.kind === 'planning' ? route.action : action} requires --task <id>.`, { exitCode: 2 });
  }

  if (route.kind === 'patrol') {
    return buildTeamPatrolResult({
      cwd,
      taskId,
      mode: normalizeTeamPatrolMode(parsed.options.mode),
      requestedTeamRunId: String(parsed.options.team ?? '').trim()
    });
  }

  const readOnlyPlan = route.kind === 'planning' && route.action === 'plan' && Boolean(parsed.options.readOnly);
  if (Boolean(parsed.options.readOnly) && !(route.kind === 'planning' && route.action === 'plan')) {
    throw new CliError('ATM_TEAM_READ_ONLY_PLAN_ONLY', 'team --read-only is only valid with team plan (projection mode). team start remains fail-closed and mutable.', {
      exitCode: 2,
      details: { action: route.kind === 'planning' ? route.action : action, requiredCommand: `node atm.mjs team plan --task ${taskId} --read-only --json` }
    });
  }
  const explicitActorId = String(parsed.options.actor ?? '').trim();
  const envActorId = String(process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? '').trim();
  const isStart = route.kind === 'planning' && route.action === 'start';
  const planningActorId = isStart
    ? (explicitActorId || envActorId)
    : resolveTeamPlanActorId({
      cwd,
      taskId,
      explicitActorId,
      fallbackActorId: envActorId || (route.kind === 'planning' && route.action === 'plan' ? 'team-planner' : '')
    });
  const context = await buildTeamPlanningContext({
    cwd,
    taskId,
    requestedRecipeId: String(parsed.options.recipe ?? '').trim(),
    actorId: planningActorId || 'team-planner',
    requestedTeamSize: String(parsed.options.teamSize ?? '').trim(),
    brokerProposalFile: String(parsed.options.brokerProposalFile ?? '').trim(),
    providerSelectionConfig: loadTeamProviderSelectionConfigFromRepo(
      cwd,
      normalizeStringArray(parsed.options.roleProvider),
      buildCliGlobalProviderDefault(parsed.options)
    ),
    readOnly: readOnlyPlan
  });
  const { task, recipes, recipe, validation, permissionValidation, teamPlan } = context;
  const ok = validation.findings.every((finding) => finding.level !== 'error');
  const runtimeContract = buildTeamRuntimeContract({
    runtimeMode: parsed.options.runtimeMode,
    runtimeLanguage: parsed.options.runtimeLanguage,
    runtimeAdapterId: parsed.options.runtimeAdapter,
    providerId: parsed.options.provider,
    sdkId: parsed.options.sdk,
    modelId: parsed.options.model,
    roleName: 'coordinator',
    selectionConfig: context.providerSelectionConfig,
    editorBridgeDisabled: parsed.options.disableEditorBridge,
    recipe,
    allowedFiles: [...context.writePaths],
    permissionLeases: teamPlan.suggestedPermissionLeases,
    evidenceRequired: String(task.evidenceRequired ?? 'command-backed')
  });
  const runtimeBackendReadiness = inspectTeamRuntimeBackendCapabilities(cwd);

  if (route.kind === 'planning' && route.action === 'validate') {
    const permissionOk = permissionValidation.ok;
    const nonPermissionFindings = validation.findings.filter(
      (finding) => !permissionValidation.findings.includes(finding)
    );
    const safeToStart = validation.findings.every((finding) => finding.level !== 'error');
    return makeResult({
      ok: permissionOk,
      command: 'team',
      cwd,
      messages: [
        message(permissionOk ? 'info' : 'error', permissionOk ? 'ATM_TEAM_PERMISSION_VALID' : 'ATM_TEAM_PERMISSION_INVALID', permissionOk
          ? 'Team recipe and permission leases are valid.'
          : 'Team recipe or permission leases contain blocking findings.', {
          taskId,
          recipeId: recipe.recipeId,
          findingCount: permissionValidation.findings.length
        })
      ],
      evidence: {
        action: 'validate',
        dryRun: true,
        runtimeWritten: false,
        agentsSpawned: false,
        task: summarizeTask(taskId, task),
        recipe,
        recipeSources: recipes.sources,
        permissionCatalog: teamPermissionCatalog,
        validation: permissionValidation,
        safeToStart,
        relatedFindings: nonPermissionFindings,
        suggestedPermissionLeases: teamPlan.suggestedPermissionLeases,
        governanceRuntime: teamPlan.governanceRuntime,
        brokerLane: teamPlan.brokerLane,
        sharedVocabulary: buildBrokerConflictSharedVocabulary(teamPlan.brokerLane),
        runtimeContract,
        runtimeBackendReadiness,
        runtimePilot: teamPlan.runtimePilot
      }
    });
  }

  if (route.kind === 'planning' && route.action === 'start') {
    const actorId = String(parsed.options.actor ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? '').trim();
    if (!actorId) {
      throw new CliError('ATM_ACTOR_ID_MISSING', 'team start requires --actor or ATM_ACTOR_ID.', { exitCode: 2 });
    }
    if (!ok) {
      return makeResult({
        ok: false,
        command: 'team',
        cwd,
        messages: [
          message('error', 'ATM_TEAM_START_BLOCKED', 'Team start blocked by permission validation findings.', {
            taskId,
            recipeId: recipe.recipeId,
            findingCount: validation.findings.length
          })
        ],
        evidence: {
          action: 'start',
          runtimeWritten: false,
          agentsSpawned: false,
          task: summarizeTask(taskId, task),
          recipe,
          validation,
          teamPlan,
          brokerLane: teamPlan.brokerLane,
          sharedVocabulary: buildBrokerConflictSharedVocabulary(teamPlan.brokerLane),
          runtimeContract,
          runtimeBackendReadiness,
          runtimePilot: teamPlan.runtimePilot
        }
      });
    }
    const backendAdmission = evaluateTeamRuntimeBackendAdmission(runtimeContract, runtimeBackendReadiness);
    if (!backendAdmission.ok) {
      return makeResult({
        ok: false,
        command: 'team',
        cwd,
        messages: [
          message('error', 'ATM_TEAM_RUNTIME_BACKEND_MISSING', backendAdmission.reason, {
            taskId,
            recipeId: recipe.recipeId,
            providerId: runtimeContract.providerId,
            runtimeMode: runtimeContract.runtimeMode,
            executionSurface: runtimeContract.executionSurface
          })
        ],
        evidence: {
          action: 'start',
          runtimeWritten: false,
          agentsSpawned: false,
          task: summarizeTask(taskId, task),
          recipe,
          validation,
          teamPlan,
          brokerLane: teamPlan.brokerLane,
          sharedVocabulary: buildBrokerConflictSharedVocabulary(teamPlan.brokerLane),
          runtimeContract,
          runtimeBackendReadiness,
          runtimePilot: teamPlan.runtimePilot
        }
      });
    }
    const teamRun = writeTeamRun({
      cwd,
      actorId,
      taskId,
      task,
      recipe,
      teamPlan,
      validation,
      runtimeContract
    });
    const executeRequested = Boolean(parsed.options.execute);
    const providerOrchestration = executeRequested
      ? await runTeamProviderExecution({
        taskId,
        teamRunId: teamRun.teamRunId,
        cwd,
        recipe,
        runtimeContract,
        runtimePilot: teamPlan.runtimePilot,
        roleSelections: teamPlan.roleSkillPackManifest.roles,
        scopedPaths: deriveWritePaths(task, cwd)
      })
      : {
        requested: false,
        blockedReason: null,
        results: []
      };
    const executionLane = resolveTeamStartExecutionLane({
      executeRequested,
      providerExecutionCount: providerOrchestration.results.length,
      providerResultOk: providerOrchestration.results.map((result) => result.ok)
    });
    return makeResult({
      ok: !executionLane.executionBlocked,
      command: 'team',
      cwd,
      messages: [
        message(executionLane.messageLevel, executionLane.messageCode, executionLane.messageText, {
          teamRunId: teamRun.teamRunId,
          taskId,
          recipeId: recipe.recipeId,
          executeRequested,
          providerExecutionCount: providerOrchestration.results.length,
          providerExecutionBlockedReason: providerOrchestration.blockedReason
        })
      ],
      evidence: {
        action: 'start',
        runtimeWritten: true,
        agentsSpawned: providerOrchestration.results.length > 0,
        executeRequested,
        teamRunPath: `.atm/runtime/team-runs/${teamRun.teamRunId}.json`,
        teamRun,
        governanceRuntime: teamPlan.governanceRuntime,
        providerOrchestration,
        brokerLane: teamPlan.brokerLane,
        runtimeContract,
        runtimeBackendReadiness,
        runtimePilot: teamPlan.runtimePilot
      }
    });
  }

  return makeResult({
    ok,
    command: 'team',
    cwd,
    messages: [
      message(ok ? 'info' : 'error', ok ? 'ATM_TEAM_PLAN_READY' : 'ATM_TEAM_PLAN_INVALID', ok
        ? (readOnlyPlan
          ? 'Team plan read-only projection completed. Broker registry cleanup was not persisted and no agents were spawned.'
          : 'Team plan dry-run completed. No runtime state was written and no agents were spawned.')
        : 'Team plan found permission conflicts. No runtime state was written and no agents were spawned.', {
        taskId,
        recipeId: recipe.recipeId,
        findingCount: validation.findings.length,
        readOnly: readOnlyPlan,
        actorId: planningActorId
      })
    ],
    evidence: {
      action: 'plan',
      dryRun: true,
      readOnly: readOnlyPlan,
      runtimeWritten: false,
      agentsSpawned: false,
      actorId: planningActorId,
      task: summarizeTask(taskId, task),
      recipe,
      recipeSources: recipes.sources,
      permissionCatalog: teamPermissionCatalog,
      validation,
      teamPlan,
      governanceRuntime: teamPlan.governanceRuntime,
      runtimeContract,
      runtimeBackendReadiness,
      brokerLane: teamPlan.brokerLane,
      sharedVocabulary: buildBrokerConflictSharedVocabulary(teamPlan.brokerLane),
      runtimePilot: teamPlan.runtimePilot
    }
  });
}

function runTeamHandoff(argv: string[], cwd: string) {
  const action = String(argv[0] ?? 'show').toLowerCase();
  const taskId = readOptionValue(argv, '--task')?.trim();
  const teamRunId = readOptionValue(argv, '--team')?.trim();
  const continuationFrom = readOptionValue(argv, '--continuation-from')?.trim() ?? '';
  const actorId = readOptionValue(argv, '--actor')?.trim() ?? '';
  if (!taskId || !teamRunId || !actorId) throw new CliError('ATM_TEAM_HANDOFF_TASK_RUN_REQUIRED', 'team handoff requires --task, --team, and --actor.', { exitCode: 2 });
  if (!['show', 'context', 'stats', 'materialize'].includes(action)) throw new CliError('ATM_CLI_USAGE', 'team handoff supports: show, context, stats, materialize.', { exitCode: 2 });
  const permission = action === 'materialize' ? 'handoff.materialize' : 'handoff.read';
  assertTeamHandoffHardGate({ cwd, taskId, teamRunId, actorId, permission });
  const integrity = verifyTeamHandoffLedger(cwd, taskId, teamRunId);
  if (!integrity.ok) throw new CliError('ATM_TEAM_HANDOFF_INTEGRITY_BLOCKED', `handoff-integrity-blocked: ${integrity.reason}.`, { exitCode: 1 });
  const directory = teamHandoffRuntimeDirectory(cwd, taskId, teamRunId);
  let sourceDirectory = directory;
  let sourceManifest = integrity.manifest;
  if (continuationFrom) {
    if (action !== 'context') throw new CliError('ATM_TEAM_HANDOFF_CONTINUATION_CONTEXT_ONLY', 'Continuation is only available through team handoff context.', { exitCode: 1 });
    const prior = verifyTeamHandoffHistory(cwd, taskId, continuationFrom);
    if (!prior.ok || prior.manifest.runOutcome === 'running') throw new CliError('ATM_TEAM_HANDOFF_CONTINUATION_BLOCKED', `handoff-integrity-blocked: terminal same-task continuation is required (${prior.reason ?? 'prior run is not terminal'}).`, { exitCode: 1 });
    sourceDirectory = teamHandoffHistoryDirectory(cwd, taskId, continuationFrom);
    sourceManifest = prior.manifest;
    appendTeamRuntimeObservabilityEvents(cwd, teamRunId, [createTeamObservabilityEvent({ eventType: 'handoff.consumed', taskId, teamRunId, providerId: 'unknown', role: 'coordinator', runtimeMode: 'broker-only', artifactType: 'atm.teamRoleHandoffArtifact.v1', artifactId: continuationFrom, decisionClass: 'auto-execution', decisionReason: 'same-task terminal continuation consumed through Coordinator context builder', violationStatus: 'none', statusCode: 'none', summary: `Continuation from terminal run ${continuationFrom} consumed.` })]);
  }
  const artifacts = readTeamHandoffArtifacts(sourceDirectory, sourceManifest);
  const bounded = artifacts.slice(-TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS).map((artifact) => ({ role: artifact.from.role, providerId: artifact.from.providerId, outputTextPreview: artifact.humanSummary }));
  const context = buildDirectTeamRoleInstructions({ taskId, role: 'consumer', priorRoleArtifacts: bounded });
  return makeResult({ ok: true, command: 'team', cwd, messages: [message('info', 'ATM_TEAM_HANDOFF_READY', `Team handoff ${action} is ready.`)], evidence: { action: `handoff.${action}`, taskId, teamRunId, continuationFrom: continuationFrom || null, permission, manifest: sourceManifest, artifacts: action === 'show' ? artifacts : undefined, context: action === 'context' ? context : undefined, stats: action === 'stats' ? { transitionCount: sourceManifest.transitionCount, contextTokens: context.telemetry.actualTokenCount } : undefined } });
}

function assertTeamHandoffHardGate(input: { cwd: string; taskId: string; teamRunId: string; actorId: string; permission: 'handoff.read' | 'handoff.materialize' }) {
  const definition = teamPermissionCatalog.find((entry) => entry.id === input.permission);
  const run = readTeamRun(input.cwd, input.teamRunId) as Record<string, unknown>;
  const runActorId = String(run.actorId ?? '').trim();
  const runTaskId = String(run.taskId ?? '').trim();
  const roles = Array.isArray(run.roles) ? run.roles : Array.isArray(run.agents) ? run.agents : [];
  const coordinator = roles.find((entry: any) => entry?.role === 'coordinator') as { agentId?: unknown; permissions?: unknown } | undefined;
  const coordinatorAgentId = String(coordinator?.agentId ?? '').trim();
  const coordinatorPermissions = Array.isArray(coordinator?.permissions) ? coordinator.permissions.map(String) : [];
  const leases = normalizePermissionLeaseRecords(run.permissionLeases ?? run.leases);
  const matchingLease = leases.find((lease) => lease.permission === input.permission && lease.agentId === coordinatorAgentId && Array.isArray(lease.paths) && lease.paths.length > 0);
  const hasCoordinator = Boolean(coordinatorAgentId);
  const authorizedActor = input.actorId === 'system' || (input.actorId === runActorId && hasCoordinator);
  if (!definition || definition.hardGate !== true || definition.scopeRequired !== true || runTaskId !== input.taskId || !authorizedActor || !coordinatorPermissions.includes(input.permission) || !matchingLease) {
    throw new CliError('ATM_TEAM_PERMISSION_HARD_GATE_BLOCKED', `handoff-integrity-blocked: ${input.permission} requires the bound Coordinator/system authority for this task and run.`, {
      exitCode: 1,
      details: { gateId: 'ATM_TEAM_PERMISSION_HARD_GATE', permission: input.permission, taskId: input.taskId, teamRunId: input.teamRunId, runTaskId, runActorId, coordinatorAgentId, hasCoordinator, coordinatorPermissionGranted: coordinatorPermissions.includes(input.permission), scopedLeaseGranted: Boolean(matchingLease) }
    });
  }
}

export function buildBrokerConflictSharedVocabulary(brokerLane: TeamBrokerLaneEvidence) {
  if (brokerLane.safeToStart) {
    return null;
  }
  const firstReason = brokerLane.blockedReasons[0] ?? 'Team Broker did not grant start authority.';
  return {
    decisionClass: 'blocked',
    decisionReason: firstReason.includes('broker-conflict-blocked')
      ? firstReason
      : `broker-conflict-blocked: ${firstReason}`,
    violationStatus: 'broker-conflict-blocked',
    statusCode: 'broker-conflict-blocked'
  };
}

function evaluateTeamRuntimeBackendAdmission(
  runtimeContract: TeamRuntimeContract,
  readiness: ReturnType<typeof inspectTeamRuntimeBackendCapabilities>
) {
  return runtimeBackendAdmissionForTeam({
    runtimeMode: runtimeContract.runtimeMode,
    providerId: runtimeContract.providerId,
    executionSurface: runtimeContract.executionSurface,
    capabilities: readiness.capabilities
  });
}

export function buildBrokerConflictUxProjection(input: {
  readonly primaryTaskId: string;
  readonly conflictingTaskIds: readonly string[];
  readonly sharedPaths?: readonly string[];
  readonly overlappingAtomIds?: readonly string[];
  readonly decisionClass: string;
  readonly decisionReason: string;
  readonly violationStatus: string;
  readonly statusCode?: string;
  readonly currentAllowedTaskId?: string | null;
  readonly blockedTaskIds?: readonly string[];
  readonly requiredCommand?: string | null;
}) {
  const primaryTaskId = String(input.primaryTaskId ?? '').trim();
  const conflictingTaskIds = uniqueStrings(input.conflictingTaskIds.map((entry) => String(entry).trim()).filter(Boolean));
  const sharedPaths = uniqueStrings((input.sharedPaths ?? []).map((entry) => String(entry).trim()).filter(Boolean));
  const overlappingAtomIds = uniqueStrings((input.overlappingAtomIds ?? []).map((entry) => String(entry).trim()).filter(Boolean));
  const currentAllowedTaskId = input.currentAllowedTaskId ?? primaryTaskId;
  const blockedTaskIds = uniqueStrings((input.blockedTaskIds?.length ? input.blockedTaskIds : conflictingTaskIds)
    .map((entry) => String(entry).trim())
    .filter(Boolean));
  const decisionReason = String(input.decisionReason ?? '').trim()
    || 'broker-conflict-blocked until the release order grants the next task.';
  const nextSafeResolutionCommand = input.requiredCommand?.trim()
    || `node atm.mjs team broker resolve --task ${primaryTaskId} --conflict ${conflictingTaskIds[0] ?? '<task-id>'} --path ${sharedPaths[0] ?? '<shared-path>'} --decision-reason "broker-conflict-blocked until the release order grants the next task." --json`;
  return {
    schemaId: 'atm.brokerConflictUx.v1',
    playbookSlice: 'broker-conflict-resolution',
    requiredResolutionArtifact: 'atm.brokerConflictResolution.v1',
    decisionClass: input.decisionClass,
    decisionReason,
    violationStatus: input.violationStatus,
    statusCode: input.statusCode ?? input.violationStatus,
    primaryTaskId,
    conflictingTaskIds,
    blockedTaskIds,
    currentAllowedTaskId,
    sharedPaths,
    overlappingAtomIds,
    nextSafeResolutionCommand,
    captainGuidance: [
      'Stop write progression while violationStatus is broker-conflict-blocked.',
      'Use the nextSafeResolutionCommand to produce an atm.brokerConflictResolution.v1 artifact.',
      'Do not hand-edit .atm/runtime/** to clear or reorder the conflict.'
    ]
  };
}

function runTeamBroker(argv: string[], defaultCwd: string) {
  const action = String(argv[0] ?? '').toLowerCase();
  if (!['resolve', 'conflict-resolve'].includes(action)) {
    throw new CliError('ATM_CLI_USAGE', 'team broker supports: resolve', { exitCode: 2 });
  }
  return runTeamBrokerConflictResolve(argv.slice(1), defaultCwd);
}

function runTeamObservability(argv: string[], defaultCwd: string) {
  const action = String(argv[0] ?? '').toLowerCase();
  if (action !== 'query') {
    throw new CliError('ATM_CLI_USAGE', 'team observability supports: query', { exitCode: 2 });
  }

  const cwd = path.resolve(readOptionValue(argv, '--cwd') ?? defaultCwd);
  const fixture = readOptionValue(argv, '--fixture')?.trim() ?? null;
  const filters = {
    taskId: readOptionValue(argv, '--task-filter') ?? readOptionValue(argv, '--task'),
    teamRunId: readOptionValue(argv, '--team-run-filter') ?? readOptionValue(argv, '--team-run'),
    providerId: readOptionValue(argv, '--provider-filter') ?? readOptionValue(argv, '--provider'),
    role: readOptionValue(argv, '--role-filter') ?? readOptionValue(argv, '--role'),
    artifactType: readOptionValue(argv, '--artifact') ?? readOptionValue(argv, '--artifact-type'),
    eventType: readOptionValue(argv, '--event-type') as any
  };

  if (!fixture) {
    const events = readTeamRuntimeObservabilityEvents(cwd, readOptionValue(argv, '--team-run'));
    const query = queryTeamObservabilityEvents(events, filters);
    return makeResult({
      ok: true,
      command: 'team observability query',
      mode: 'standalone',
      cwd,
      messages: [
        message('info', 'ATM_TEAM_OBSERVABILITY_QUERY_READY', 'Team observability query returned runtime event records.', {
          eventCount: query.eventCount,
          filters: query.filters
        })
      ],
      evidence: {
        action: 'observability.query',
        dryRun: true,
        fixture: null,
        eventSource: 'runtime',
        contract: buildTeamObservabilityContract(),
        query
      }
    });
  }

  if (fixture !== 'broker-conflict-resolution') {
    throw new CliError('ATM_TEAM_OBSERVABILITY_FIXTURE_UNSUPPORTED', `Unsupported team observability fixture: ${fixture}`, { exitCode: 2 });
  }

  const emittedAt = readOptionValue(argv, '--emitted-at') ?? '2026-07-10T00:00:00.000Z';
  const primaryTaskId = String(readOptionValue(argv, '--task') ?? 'TASK-TEAM-0040').trim();
  const conflictingTaskIds = readOptionValues(argv, '--conflict');
  const sharedPaths = readOptionValues(argv, '--path');
  const artifact = createBrokerConflictResolutionArtifact({
    primaryTaskId,
    conflictingTaskIds: conflictingTaskIds.length > 0 ? conflictingTaskIds : ['TASK-TEAM-0047'],
    sharedPaths: sharedPaths.length > 0 ? sharedPaths : ['packages/cli/src/commands/team.ts'],
    decisionClass: normalizeBrokerDecisionClass(readOptionValue(argv, '--decision-class')),
    decisionReason: readOptionValue(argv, '--decision-reason')
      ?? 'broker-conflict-blocked until the release order grants the next task.',
    violationStatus: normalizeBrokerViolationStatus(readOptionValue(argv, '--violation-status')),
    releaseOrder: readOptionValues(argv, '--release-order'),
    createdAt: emittedAt
  });
  const providerId = String(readOptionValue(argv, '--provider') ?? 'openai').trim() as any;
  const role = String(readOptionValue(argv, '--role') ?? 'coordinator').trim();
  const teamRunId = readOptionValue(argv, '--team-run') ?? `team-observability-${artifact.resolutionId.toLowerCase()}`;
  const events = createBrokerConflictObservabilityEvents({
    artifact,
    providerId,
    role,
    teamRunId,
    emittedAt
  });
  const query = queryTeamObservabilityEvents(events, filters);

  return makeResult({
    ok: true,
    command: 'team observability query',
    mode: 'standalone',
    cwd,
    messages: [
      message('info', 'ATM_TEAM_OBSERVABILITY_QUERY_READY', 'Team observability query returned shared event records.', {
        eventCount: query.eventCount,
        filters: query.filters
      })
    ],
    evidence: {
      action: 'observability.query',
      dryRun: true,
      fixture,
      eventSource: 'fixture',
      contract: buildTeamObservabilityContract(),
      artifact,
      query
    }
  });
}

function readTeamRuntimeObservabilityEvents(cwd: string, requestedTeamRunId?: string | null) {
  const runIds = requestedTeamRunId?.trim()
    ? [requestedTeamRunId.trim()]
    : listTeamRuns(cwd).map((run) => String((run as Record<string, unknown>).teamRunId ?? '')).filter(Boolean);
  const events: ReturnType<typeof createTeamObservabilityEvent>[] = [];
  for (const teamRunId of runIds) {
    const runDir = path.join(teamRunsDirectory(cwd), teamRunId);
    const jsonlPath = path.join(runDir, 'observability-events.jsonl');
    if (existsSync(jsonlPath)) {
      for (const line of readFileSync(jsonlPath, 'utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed?.schemaId === 'atm.teamAgentObservabilityEvent.v1') {
            events.push(parsed);
          }
        } catch {
          // Ignore malformed runtime event lines; validators can flag corruption separately.
        }
      }
    }
    const run = existsSync(path.join(teamRunsDirectory(cwd), `${teamRunId}.json`))
      ? readTeamRun(cwd, teamRunId) as Record<string, unknown>
      : null;
    const embedded = Array.isArray(run?.observabilityEvents) ? run.observabilityEvents : [];
    for (const event of embedded) {
      if ((event as { schemaId?: unknown })?.schemaId === 'atm.teamAgentObservabilityEvent.v1') {
        events.push(event as ReturnType<typeof createTeamObservabilityEvent>);
      }
    }
  }
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.eventId)) return false;
    seen.add(event.eventId);
    return true;
  });
}

export function runTeamBrokerConflictResolve(argv: string[], defaultCwd: string) {
  const cwd = path.resolve(readOptionValue(argv, '--cwd') ?? defaultCwd);
  const primaryTaskId = readOptionValue(argv, '--task')?.trim();
  if (!primaryTaskId) {
    throw new CliError('ATM_TEAM_BROKER_RESOLVE_TASK_REQUIRED', 'team broker resolve requires --task <id>.', { exitCode: 2 });
  }
  const conflictingTaskIds = readOptionValues(argv, '--conflict');
  if (conflictingTaskIds.length === 0) {
    throw new CliError('ATM_TEAM_BROKER_RESOLVE_CONFLICT_REQUIRED', 'team broker resolve requires at least one --conflict <task-id>.', { exitCode: 2 });
  }
  const sharedPaths = readOptionValues(argv, '--path');
  if (sharedPaths.length === 0) {
    throw new CliError('ATM_TEAM_BROKER_RESOLVE_PATH_REQUIRED', 'team broker resolve requires at least one --path <file>.', { exitCode: 2 });
  }
  const decisionReason = readOptionValue(argv, '--decision-reason')?.trim()
    ?? 'Broker conflict blocked; tasks must consume the release order one at a time.';
  const decisionClass = normalizeBrokerDecisionClass(readOptionValue(argv, '--decision-class'));
  const violationStatus = normalizeBrokerViolationStatus(readOptionValue(argv, '--violation-status'));
  const releaseOrder = readOptionValues(argv, '--release-order');
  const createdAt = readOptionValue(argv, '--created-at')?.trim();
  const artifact = createBrokerConflictResolutionArtifact({
    primaryTaskId,
    conflictingTaskIds,
    sharedPaths,
    decisionClass,
    decisionReason,
    violationStatus,
    releaseOrder: releaseOrder.length ? releaseOrder : undefined,
    createdAt
  });
  const requestedOutput = readOptionValue(argv, '--output')?.trim();
  const artifactPath = requestedOutput
    ? path.resolve(cwd, requestedOutput)
    : path.join(cwd, '.atm', 'runtime', 'broker-conflict-resolutions', `${artifact.resolutionId}.json`);
  mkdirSync(path.dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  const conflictUx = buildBrokerConflictUxProjection({
    primaryTaskId: artifact.primaryTaskId,
    conflictingTaskIds: artifact.conflictingTaskIds,
    sharedPaths: artifact.sharedPaths,
    decisionClass: artifact.decisionClass,
    decisionReason: artifact.decisionReason,
    violationStatus: artifact.violationStatus,
    statusCode: artifact.statusCode,
    currentAllowedTaskId: artifact.currentAllowedTaskId,
    blockedTaskIds: artifact.blockedTaskIds,
    requiredCommand: `node atm.mjs team broker resolve --task ${artifact.primaryTaskId} ${artifact.conflictingTaskIds.map((taskId) => `--conflict ${taskId}`).join(' ')} ${artifact.sharedPaths.map((sharedPath) => `--path ${sharedPath}`).join(' ')} --decision-reason "${artifact.decisionReason}" --json`
  });

  return makeResult({
    ok: true,
    command: 'team',
    cwd,
    messages: [
      message('info', 'ATM_TEAM_BROKER_CONFLICT_RESOLUTION_READY', 'Team Broker conflict resolution artifact generated.', {
        resolutionId: artifact.resolutionId,
        decisionClass: artifact.decisionClass,
        violationStatus: artifact.violationStatus,
        statusCode: artifact.statusCode,
        currentAllowedTaskId: artifact.currentAllowedTaskId,
        blockedTaskIds: artifact.blockedTaskIds,
        sharedPaths: artifact.sharedPaths,
        decisionReason: artifact.decisionReason,
        requiredResolutionArtifact: conflictUx.requiredResolutionArtifact,
        nextSafeResolutionCommand: conflictUx.nextSafeResolutionCommand
      })
    ],
    evidence: {
      action: 'broker.resolve',
      dryRun: false,
      runtimeWritten: true,
      agentsSpawned: false,
      artifact,
      artifactPath: path.relative(cwd, artifactPath).replace(/\\/g, '/'),
      conflictUx,
      sharedVocabulary: {
        decisionClass: artifact.decisionClass,
        decisionReason: artifact.decisionReason,
        violationStatus: artifact.violationStatus,
        statusCode: artifact.statusCode
      }
    }
  });
}

function readOptionValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return argv[index + 1];
}

function readOptionValues(argv: string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) continue;
    values.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
  }
  return [...new Set(values)];
}

function normalizeBrokerDecisionClass(value: string | undefined): BrokerConflictDecisionClass {
  const normalized = value?.trim();
  if (
    normalized === 'serial-release'
    || normalized === 'human-signoff-required'
    || normalized === 'adr-required'
    || normalized === 'blocked'
  ) {
    return normalized;
  }
  return 'serial-release';
}

function normalizeBrokerViolationStatus(value: string | undefined): BrokerConflictViolationStatus {
  const normalized = value?.trim();
  if (
    normalized === 'broker-conflict-blocked'
    || normalized === 'resolution-issued'
    || normalized === 'resolved'
  ) {
    return normalized;
  }
  return 'broker-conflict-blocked';
}


export function buildTeamRuntimeContract(input: {
  runtimeMode?: unknown;
  runtimeLanguage?: unknown;
  runtimeAdapterId?: unknown;
  providerId?: unknown;
  sdkId?: unknown;
  modelId?: unknown;
  roleName?: unknown;
    selectionConfig?: TeamProviderSelectionConfig | null;
  editorBridgeDisabled?: unknown;
  recipe?: TeamRecipe;
  allowedFiles?: readonly string[];
  permissionLeases?: readonly PermissionLease[];
  evidenceRequired?: unknown;
}): TeamRuntimeContract {
  const runtimeMode = normalizeTeamRuntimeMode(input.runtimeMode);
  const runtimeLanguage = normalizeOptionalRuntimeString(input.runtimeLanguage) ?? 'node';
  const runtimeAdapterId = normalizeOptionalRuntimeString(input.runtimeAdapterId);
  const providerId = normalizeOptionalRuntimeString(input.providerId);
  const sdkId = normalizeOptionalRuntimeString(input.sdkId);
  const modelId = normalizeOptionalRuntimeString(input.modelId);
  const roleName = normalizeOptionalRuntimeString(input.roleName) ?? 'coordinator';
  const explicitRuntimeMode = Boolean(normalizeOptionalRuntimeString(input.runtimeMode));
  const explicitProviderId = Boolean(normalizeOptionalRuntimeString(input.providerId));
  const explicitSdkId = Boolean(normalizeOptionalRuntimeString(input.sdkId));
  const explicitModelId = Boolean(normalizeOptionalRuntimeString(input.modelId));
  const providerSelection = resolveTeamRuntimeProviderSelection({
    roleName,
    selectionConfig: input.selectionConfig,
    runtimeMode: explicitRuntimeMode ? runtimeMode : 'broker-only',
    providerId,
    sdkId,
    modelId,
    explicitRuntimeMode,
    explicitProviderId,
    explicitSdkId,
    explicitModelId
  });
  const selectionDecision = providerSelection.selectionDecision;
  const effectiveRuntimeMode = explicitRuntimeMode
    ? providerSelection.runtimeMode as TeamRuntimeMode
    : providerSelection.selectionDecision?.runtimeMode ?? runtimeMode;
  const effectiveProviderId = providerSelection.providerId;
  const effectiveSdkId = providerSelection.sdkId;
  const effectiveModelId = providerSelection.modelId;
  const editorBridgeDisabled = Boolean(input.editorBridgeDisabled);
  const workerAdapter = resolveNodejsTeamWorkerAdapter({
    runtimeMode: effectiveRuntimeMode,
    runtimeLanguage,
    runtimeAdapterId,
    providerId: effectiveProviderId,
    sdkId: effectiveSdkId,
    modelId: effectiveModelId
  });
  const agentsSpawned = workerAdapter.agentsSpawned;
  const executionSurface = workerAdapter.executionSurface;

  return {
    schemaId: 'atm.teamRuntimeContract.v1',
    runtimeMode: effectiveRuntimeMode,
    runtimeLanguage,
    runtimeAdapterId: runtimeAdapterId ?? workerAdapter.adapterId,
    providerId: effectiveProviderId ?? workerAdapter.providerId,
    sdkId: effectiveSdkId ?? workerAdapter.sdkId,
    modelId: effectiveModelId ?? workerAdapter.modelId,
    agentsSpawned,
    executionSurface,
    selectionReason: describeRuntimeSelection({
      runtimeMode: effectiveRuntimeMode,
      runtimeLanguage,
      runtimeAdapterId: runtimeAdapterId ?? workerAdapter.adapterId,
      selectionSource: selectionDecision?.source ?? null,
      roleName
    }),
    workerAdapter,
    artifactHandoff: buildTeamArtifactHandoffContract({
      recipe: input.recipe,
      requiredRoles: ['implementer', 'reviewer', 'validator', 'evidence-collector'],
      producedArtifacts: []
    }),
    retryBudget: buildTeamRetryBudgetContract({}),
    commitLane: buildTeamCommitLaneContract(),
    brokerSubagent: buildTeamBrokerSubagentContract(),
    editorSubagentBridge: buildEditorSubagentBridgeContract({
      enabled: runtimeMode === 'editor-subagent' && !editorBridgeDisabled,
      disabledReason: runtimeMode !== 'editor-subagent'
        ? 'runtime-mode-is-not-editor-subagent'
        : editorBridgeDisabled
          ? 'disabled-by-run-option'
          : null,
      recipe: input.recipe,
      allowedFiles: input.allowedFiles ?? [],
      permissionLeases: input.permissionLeases ?? [],
      evidenceRequired: String(input.evidenceRequired ?? 'command-backed')
    })
  };
}

function buildTeamBrokerSubagentContract(): TeamBrokerSubagentContract {
  return {
    schemaId: 'atm.teamBrokerSubagentContract.v1',
    enabled: true,
    subagentId: 'team-broker-subagent',
    lifecycleOwner: 'atm',
    decisionSurface: 'brokerLane',
    governs: ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane'],
    stewardId: 'neutral-write-steward',
    evidenceRequired: ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1'],
    authorityBoundary: {
      fileWrite: false,
      gitWrite: false,
      taskLifecycle: false,
      selfClose: false
    },
    escalationTarget: 'coordinator'
  };
}

function buildTeamCommitLaneContract(): TeamCommitLaneContract {
  return {
    schemaId: 'atm.teamCommitLaneContract.v1',
    ownerRole: 'coordinator',
    ownerPermissions: ['task.lifecycle', 'git.write', 'evidence.write'],
    workerGitWrite: false,
    serializedBy: 'branch-commit-queue',
    lockSchemaId: 'atm.branchCommitQueueLock.v1',
    retryableCodes: ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE']
  };
}

export function buildTeamClosureAttestation(input: TeamClosureAttestationInput): TeamClosureAttestationEvidence {
  const runtime = input.runtimeContract ?? null;
  const runtimeMode = normalizeTeamRuntimeMode(input.runtimeMode ?? runtime?.runtimeMode);
  const runtimeLanguage = normalizeOptionalRuntimeString(input.runtimeLanguage ?? runtime?.runtimeLanguage) ?? 'node';
  const runtimeAdapterId = normalizeOptionalRuntimeString(input.runtimeAdapterId ?? runtime?.runtimeAdapterId);
  const providerId = normalizeOptionalRuntimeString(input.providerId ?? runtime?.providerId);
  const sdkId = normalizeOptionalRuntimeString(input.sdkId ?? runtime?.sdkId);
  const modelId = normalizeOptionalRuntimeString(input.modelId ?? runtime?.modelId);
  const runnerKind = normalizeOptionalRuntimeString(input.runnerKind) ?? (runtime?.agentsSpawned ? 'team-agent-runtime' : 'broker-governance');
  const sandboxPolicyHash = normalizeOptionalRuntimeString(input.sandboxPolicyHash)
    ?? createHash('sha256')
      .update([
        'local-runtime-wrapper-is-not-secure-sandbox-proof',
        runtimeMode,
        runtimeLanguage,
        runtimeAdapterId ?? '',
        providerId ?? '',
        sdkId ?? '',
        modelId ?? ''
      ].join('\n'))
      .digest('hex');
  return {
    schemaId: TEAM_CLOSURE_ATTESTATION_SCHEMA_ID,
    teamRunId: normalizeOptionalRuntimeString(input.teamRunId) ?? 'manual-team-run',
    runtimeMode,
    runtimeLanguage,
    runtimeAdapterId,
    providerId,
    sdkId,
    modelId,
    runnerKind,
    runtimeVersion: normalizeOptionalRuntimeString(input.runtimeVersion),
    sandboxPolicyHash: `sha256:${sandboxPolicyHash.replace(/^sha256:/, '')}`,
    attestationSigner: normalizeOptionalRuntimeString(input.attestationSigner) ?? 'coordinator',
    brokerSubagent: buildBrokerSubagentAttestation(runtime?.brokerSubagent),
    commitLane: buildCommitLaneAttestation(runtime?.commitLane),
    workerAuthorityBoundary: buildWorkerAuthorityBoundaryAttestation(runtime?.workerAdapter),
    reviewerIndependence: buildReviewerIndependenceAttestation(input.reviewerIndependence),
    attestedAt: normalizeOptionalRuntimeString(input.attestedAt) ?? new Date().toISOString(),
    localRuntimeWrapperIsSecureSandboxProof: false,
    commandBackedEvidenceRequired: true
  };
}

function buildBrokerSubagentAttestation(input: TeamRuntimeContract['brokerSubagent'] | null | undefined) {
  const boundary = (input?.authorityBoundary ?? {}) as Record<string, unknown>;
  return {
    schemaId: normalizeOptionalRuntimeString(input?.schemaId),
    enabled: input?.enabled === true,
    subagentId: normalizeOptionalRuntimeString(input?.subagentId),
    decisionSurface: normalizeOptionalRuntimeString(input?.decisionSurface),
    stewardId: normalizeOptionalRuntimeString(input?.stewardId),
    governs: normalizeStringArray(input?.governs),
    evidenceRequired: normalizeStringArray(input?.evidenceRequired),
    authorityBoundary: {
      fileWrite: boundary?.fileWrite === true,
      gitWrite: boundary?.gitWrite === true,
      taskLifecycle: boundary?.taskLifecycle === true,
      selfClose: boundary?.selfClose === true
    }
  };
}

function buildCommitLaneAttestation(input: TeamRuntimeContract['commitLane'] | null | undefined) {
  const lane = (input ?? {}) as Record<string, unknown>;
  return {
    schemaId: normalizeOptionalRuntimeString(input?.schemaId),
    serializedBy: normalizeOptionalRuntimeString(input?.serializedBy),
    ownerRole: normalizeOptionalRuntimeString(input?.ownerRole),
    workerGitWrite: lane.workerGitWrite === true
  };
}

function buildWorkerAuthorityBoundaryAttestation(input: TeamWorkerAdapterContract | null | undefined) {
  const boundary = (input?.authorityBoundary ?? {}) as Record<string, unknown>;
  return {
    gitWrite: boundary.gitWrite === true,
    taskLifecycle: boundary.taskLifecycle === true,
    selfClose: boundary.selfClose === true,
    evidenceWriteOwner: normalizeOptionalRuntimeString(boundary?.evidenceWriteOwner)
  };
}

function buildReviewerIndependenceAttestation(input: Partial<TeamClosureReviewerIndependenceEvidence> | null | undefined): TeamClosureReviewerIndependenceEvidence {
  const required = input?.required !== false;
  const satisfied = input?.satisfied === true;
  return {
    required,
    satisfied,
    policy: normalizeOptionalRuntimeString(input?.policy) ?? 'reviewer-runtime-and-model-independent-from-implementer-when-required',
    reviewerProviderId: normalizeOptionalRuntimeString(input?.reviewerProviderId),
    reviewerModelId: normalizeOptionalRuntimeString(input?.reviewerModelId),
    reviewerRuntimeAdapterId: normalizeOptionalRuntimeString(input?.reviewerRuntimeAdapterId),
    reason: normalizeOptionalRuntimeString(input?.reason) ?? (satisfied ? 'reviewer independence policy satisfied' : 'reviewer independence policy unsatisfied')
  };
}

function buildEditorSubagentBridgeContract(input: {
  enabled: boolean;
  disabledReason: string | null;
  recipe?: TeamRecipe;
  allowedFiles: readonly string[];
  permissionLeases: readonly PermissionLease[];
  evidenceRequired: string;
}): TeamEditorSubagentBridgeContract {
  const allowedFiles = uniqueStrings(input.allowedFiles.map((entry) => String(entry).trim()).filter(Boolean));
  const leasesByAgent = new Map<string, PermissionLease[]>();
  for (const lease of input.permissionLeases) {
    leasesByAgent.set(lease.agentId, [...(leasesByAgent.get(lease.agentId) ?? []), {
      permission: lease.permission,
      agentId: lease.agentId,
      paths: lease.paths ? [...lease.paths] : undefined
    }]);
  }
  const roleEnvelopes = (input.recipe?.agents ?? []).map((agent) => {
    const permissionLeases = leasesByAgent.get(agent.agentId) ?? [];
    const artifactContract = buildTeamRoleArtifactContract({
      agentId: agent.agentId,
      role: agent.role
    });
    return {
      schemaId: 'atm.teamEditorSubagentRoleEnvelope.v1' as const,
      agentId: agent.agentId,
      role: agent.role,
      profile: agent.profile ?? null,
      language: agent.language ?? input.recipe?.language ?? null,
      permissions: [...agent.permissions],
      allowedFiles,
      leaseMetadata: {
        permissionLeases,
        leaseOwner: agent.agentId
      },
      artifactMetadata: {
        expectedReports: [
          'agent report',
          'validator evidence',
          'team summary'
        ],
        evidenceRequired: input.evidenceRequired,
        consumesFrom: artifactContract.consumesFrom,
        producesTo: artifactContract.producesTo,
        requiredArtifacts: artifactContract.requiredArtifacts
      },
      retryMetadata: {
        retryPolicy: 'atm-governed' as const,
        maxAttempts: 1
      }
    };
  });

  return {
    schemaId: 'atm.teamEditorSubagentBridgeContract.v1',
    enabled: input.enabled,
    lifecycleOwner: 'atm',
    disabledReason: input.disabledReason,
    editorNeutral: true,
    allowedFiles,
    roleEnvelopes
  };
}

function normalizeTeamRuntimeMode(value: unknown): TeamRuntimeMode {
  const normalized = String(value ?? 'broker-only').trim();
  if (normalized === 'real-agent' || normalized === 'editor-subagent' || normalized === 'broker-only') {
    return normalized;
  }
  throw new CliError('ATM_TEAM_RUNTIME_MODE_INVALID', `Unsupported team runtime mode: ${normalized}`, {
    exitCode: 2,
    details: { supportedModes: ['real-agent', 'editor-subagent', 'broker-only'] }
  });
}

function normalizeOptionalRuntimeString(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : null;
}

function buildCliGlobalProviderDefault(options: Record<string, unknown>): Partial<TeamRoleProviderOverride> | null {
  const providerId = normalizeOptionalRuntimeString(options.provider);
  const sdkId = normalizeOptionalRuntimeString(options.sdk);
  const modelId = normalizeOptionalRuntimeString(options.model);
  const runtimeModeRaw = normalizeOptionalRuntimeString(options.runtimeMode);
  if (!providerId && !sdkId && !modelId && !runtimeModeRaw) {
    return null;
  }
  return {
    ...(providerId ? { providerId } : {}),
    ...(sdkId ? { sdkId } : {}),
    ...(modelId ? { modelId } : {}),
    ...(runtimeModeRaw ? { runtimeMode: normalizeTeamRuntimeMode(runtimeModeRaw) } : {})
  };
}

function describeRuntimeSelection(input: {
  runtimeMode: TeamRuntimeMode;
  runtimeLanguage: string;
  runtimeAdapterId: string | null;
  selectionSource?: 'repo-default' | 'cli-global-default' | 'role-override' | 'cli-role-override' | null;
  roleName?: string | null;
}): string {
  const adapter = input.runtimeAdapterId ?? 'no adapter override';
  const selectionSource = input.selectionSource
    ? `selection=${input.selectionSource}${input.roleName ? ` role=${input.roleName}` : ''}`
    : 'selection=explicit-runtime';
  if (input.runtimeMode === 'broker-only') {
    return `broker-only selected; no agents are spawned, language=${input.runtimeLanguage}, ${adapter}, ${selectionSource}`;
  }
  if (input.runtimeMode === 'editor-subagent') {
    return `editor-subagent selected; adapter metadata is advisory, language=${input.runtimeLanguage}, ${adapter}, ${selectionSource}`;
  }
  return `real-agent selected; adapter metadata is advisory until a worker bridge consumes it, language=${input.runtimeLanguage}, ${adapter}, ${selectionSource}`;
}

async function buildTeamPlanningContext(input: {
  cwd: string;
  taskId: string;
  requestedRecipeId: string;
  actorId: string;
  requestedTeamSize?: string;
  brokerProposalFile?: string;
  providerSelectionConfig?: {
    config: TeamProviderSelectionConfig;
    source: { schemaId: 'atm.teamAgentsConfig.v1'; path: string | null; loaded: boolean; cliOverrideCount: number };
  };
  readOnly?: boolean;
}) {
  let task = readTask(input.cwd, input.taskId);
  if (input.brokerProposalFile) {
    task = applyTeamBrokerProposalAdmission({
      cwd: input.cwd,
      task,
      taskId: input.taskId,
      actorId: input.actorId,
      proposalFile: input.brokerProposalFile
    });
  }
  const recipes = loadTeamRecipes(input.cwd);
  const recipe = selectRecipe({
    recipes,
    requestedRecipeId: input.requestedRecipeId,
    task
  });
  const requestedRosterLevel = normalizeTeamSizeOverride(input.requestedTeamSize)?.teamLevel ?? null;
  const activeRecipe = requestedRosterLevel ? projectTeamRecipeForLevel(recipe, requestedRosterLevel).recipe : recipe;
  const writeScope = deriveTeamWriteScope(task, input.cwd);
  // TASK-TEAM-0078: project the write scope through the canonical
  // shared-surface queue before any role or provider lease is derived, so a
  // queued task may plan/start only against its disjoint private paths and a
  // fully queued task is rejected instead of silently widening a lease.
  const queueAdmission = evaluateBrokerQueueAdmission({
    cwd: input.cwd,
    taskId: input.taskId,
    allowedFiles: writeScope.writePaths,
    overlappingFiles: []
  });
  const queueScopeDecision = restrictTeamWriteScopeForQueueAdmission(queueAdmission, writeScope.writePaths);
  const queueScopeFindings: PermissionFinding[] = [];
  if (queueScopeDecision.verdict === 'rejected') {
    queueScopeFindings.push(buildPermissionFinding({
      level: 'error',
      code: 'broker-queue-blocked',
      detail: `team plan/start rejected by canonical shared-surface queue admission (${queueAdmission.status}): ${queueScopeDecision.reason}`,
      paths: [...queueScopeDecision.queuedSharedPaths]
    }));
  } else if (queueScopeDecision.verdict === 'restricted-private-work') {
    queueScopeFindings.push(buildPermissionFinding({
      level: 'warning',
      code: 'broker-queue-private-work',
      detail: 'Role write scope is restricted to disjoint private paths while shared paths remain queued; leases must not widen beyond the canonical queue projection.',
      paths: [...queueScopeDecision.queuedSharedPaths]
    }));
  }
  const writePaths = [...queueScopeDecision.writePaths];
  const permissionValidation = validateTeamPermissionModel(activeRecipe, writePaths, {
    allowedWritePaths: deriveAllowedWriteScope(task, input.cwd),
    repoRoot: input.cwd,
    allowEmptyWriteScope: writeScope.allowEmptyWriteScope
  });

  const parallelFindings: PermissionFinding[] = [];
  try {
    const parallelResult = await runTasks([
      'parallel',
      '--task',
      input.taskId,
      '--queue',
      '--cwd',
      input.cwd,
      '--json'
    ]);
    if (parallelResult && parallelResult.ok && parallelResult.evidence && Array.isArray(parallelResult.evidence.candidates)) {
      for (const candidate of parallelResult.evidence.candidates) {
        const finding = candidate.finding;
        if (finding && finding.verdict === 'blocked-cid-conflict') {
          parallelFindings.push(buildPermissionFinding({
            level: 'error',
            code: 'blocked-cid-conflict',
            detail: `Parallel advisor identified a CID logic conflict with task ${candidate.taskId} on atom(s): ${finding.overlappingAtomIds.join(', ')}`,
            paths: finding.overlappingFiles
          }));
        }
      }
    }
  } catch (err) {
    // Best-effort check
  }

  const brokerLanePlan = planTeamBrokerLane({
    cwd: input.cwd,
    taskId: input.taskId,
    actorId: input.actorId,
    task,
    writePaths,
    readOnly: input.readOnly === true
  });
  const brokerLane = brokerLanePlan.evidence;
  const gitIndexOwnership = inspectGitIndexOwnership({
    cwd: input.cwd,
    taskId: input.taskId
  });
  const claimAdmissionFindings = buildTeamClaimAdmissionFindings(input.cwd, input.taskId, task);
  const validation = mergeValidation(
    permissionValidation,
    { ok: queueScopeFindings.every((f) => f.level !== 'error'), findings: queueScopeFindings },
    { ok: claimAdmissionFindings.every((f) => f.level !== 'error'), findings: claimAdmissionFindings },
    { ok: parallelFindings.every((f) => f.level !== 'error'), findings: parallelFindings },
    { ok: brokerLanePlan.findings.every((f) => f.level !== 'error'), findings: brokerLanePlan.findings }
  );

  const finalTeamPlan = buildTeamPlan({
    cwd: input.cwd,
    task,
    recipe: activeRecipe,
    writePaths,
    validation,
    brokerLane,
    gitIndexOwnership,
    allowEmptyWriteScope: writeScope.allowEmptyWriteScope,
    requestedTeamSize: input.requestedTeamSize,
    providerSelectionConfig: input.providerSelectionConfig?.config ?? null,
    providerSelectionSource: input.providerSelectionConfig?.source ?? null,
    knowledgeSummary: buildTeamKnowledgeSummary({
      cwd: input.cwd,
      taskId: String(task.workItemId ?? task.taskId ?? input.taskId),
      top: 3
    })
  });

  return {
    task,
    recipes,
    recipe: activeRecipe,
    permissionValidation,
    validation,
    writePaths,
    queueAdmission,
    queueScopeDecision,
    providerSelectionConfig: input.providerSelectionConfig?.config ?? null,
    providerSelectionSource: input.providerSelectionConfig?.source ?? null,
    teamPlan: {
      ...finalTeamPlan,
      validation,
      brokerLane
    }
  };
}

function applyTeamBrokerProposalAdmission(input: {
  cwd: string;
  task: Record<string, unknown>;
  taskId: string;
  actorId: string;
  proposalFile: string;
}): Record<string, unknown> {
  const proposalPath = path.resolve(input.cwd, input.proposalFile);
  let proposal: ReturnType<typeof readBrokerProposalFile>;
  try {
    proposal = readBrokerProposalFile(proposalPath);
  } catch (error) {
    throw new CliError('ATM_TEAM_BROKER_PROPOSAL_INVALID', `Team start could not read broker proposal: ${(error as Error).message}`, { exitCode: 1 });
  }
  const validation = validateBrokerProposal(proposal, { cwd: input.cwd });
  const allowed = new Set(deriveWritePaths(input.task, input.cwd));
  const hashOnlyMismatch = validation.issues.length === 1
    && validation.issues[0]?.kind === 'file-hash-mismatch'
    && String(validation.currentFileHash ?? '').replace(/^sha256:/, '') === String(proposal.fileBeforeHash ?? '').replace(/^sha256:/, '');
  if ((!validation.ok && !hashOnlyMismatch) || proposal.taskId !== input.taskId || proposal.actorId !== input.actorId || !allowed.has(proposal.targetFile.replace(/\\/g, '/'))) {
    throw new CliError('ATM_TEAM_BROKER_PROPOSAL_INVALID', 'Team start requires a current validated proposal owned by its task/actor and target write scope.', {
      exitCode: 1,
      details: { proposalFile: input.proposalFile, proposalId: proposal.proposalId, issues: validation.issues }
    });
  }
  return {
    ...input.task,
    proposalAdmission: {
      trigger: 'hot-file',
      summarySubmitted: true,
      hotFiles: [proposal.targetFile.replace(/\\/g, '/')],
      notes: `Validated broker proposal ${proposal.proposalId} consumed by team start.`
    }
  };
}

function buildTeamClaimAdmissionFindings(cwd: string, taskId: string, task: Record<string, unknown>): PermissionFinding[] {
  return findTaskClaimDependencyBlockers(cwd, taskId, task).map((blocker) => buildPermissionFinding({
    level: 'error',
    code: 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED',
    detail: `Team start is unsafe because normal task claim would be blocked by dependency ${blocker.taskId} (${blocker.status}).`,
    paths: [path.relative(cwd, blocker.taskPath).replace(/\\/g, '/')]
  }));
}

function readTask(cwd: string, taskId: string) {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) {
    throw new CliError('ATM_TEAM_TASK_NOT_FOUND', `Task not found for team plan: ${taskId}`, {
      exitCode: 2,
      details: { taskId, taskPath: path.relative(cwd, taskPath).replace(/\\/g, '/') }
    });
  }
  return readJsonFile(taskPath, 'ATM_TEAM_TASK_NOT_FOUND');
}

function loadTeamRecipes(cwd: string): { recipes: TeamRecipe[]; sources: unknown[] } {
  const recipeDir = path.join(cwd, '.atm', 'config', 'team-recipes');
  const repoRecipes = existsSync(recipeDir)
    ? readdirSync(recipeDir)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => {
        const filePath = path.join(recipeDir, entry);
        return {
          recipe: normalizeRecipe(JSON.parse(readFileSync(filePath, 'utf8'))),
          source: {
            kind: 'repo-json',
            path: path.relative(cwd, filePath).replace(/\\/g, '/')
          }
        };
      })
    : [];
  return {
    recipes: [
      ...builtInRecipes,
      ...repoRecipes.map((entry) => entry.recipe)
    ],
    sources: [
      { kind: 'built-in-json', recipeIds: builtInRecipes.map((entry) => entry.recipeId) },
      ...repoRecipes.map((entry) => entry.source)
    ]
  };
}

function normalizeRecipe(value: Record<string, unknown> | null | undefined): TeamRecipe {
  if ((value as { schemaId?: unknown })?.schemaId !== 'atm.teamRecipe.v1') {
    throw new CliError('ATM_TEAM_RECIPE_INVALID', 'Team recipe JSON must use schemaId atm.teamRecipe.v1.', { exitCode: 2 });
  }
  const recipeId = String((value as { recipeId?: unknown })?.recipeId ?? '').trim();
  if (!recipeId) {
    throw new CliError('ATM_TEAM_RECIPE_INVALID', 'Team recipe JSON requires recipeId.', { exitCode: 2 });
  }
  const agents: TeamRecipeAgent[] = Array.isArray((value as { agents?: unknown })?.agents) ? ((value as { agents: unknown[] }).agents).map((entry: unknown) => ({
    agentId: String((entry as Record<string, unknown> | null)?.agentId ?? '').trim(),
    role: String((entry as Record<string, unknown> | null)?.role ?? '').trim(),
    profile: (entry as Record<string, unknown> | null)?.profile ? String((entry as Record<string, unknown>).profile).trim() : undefined,
    language: (entry as Record<string, unknown> | null)?.language ? String((entry as Record<string, unknown>).language).trim() : undefined,
    permissions: Array.isArray((entry as Record<string, unknown> | null)?.permissions) ? ((entry as Record<string, unknown>).permissions as unknown[]).map((permission: unknown) => String(permission).trim()).filter(Boolean) : []
  })) : [];
  if (agents.length === 0 || agents.some((agent: TeamRecipeAgent) => !agent.agentId || !agent.role)) {
    throw new CliError('ATM_TEAM_RECIPE_INVALID', `Team recipe ${recipeId} requires agents with agentId and role.`, { exitCode: 2 });
  }
  return {
    schemaId: 'atm.teamRecipe.v1',
    recipeId,
    appliesTo: Array.isArray((value as { appliesTo?: unknown })?.appliesTo) ? ((value as { appliesTo: unknown[] }).appliesTo).map(String) : undefined,
    language: (value as { language?: unknown })?.language ? String((value as { language: unknown }).language) : undefined,
    agents
  };
}

function selectRecipe(input: {
  recipes: { recipes: TeamRecipe[]; sources: unknown[] };
  requestedRecipeId: string;
  task: Record<string, unknown> | null | undefined;
}) {
  if (input.requestedRecipeId) {
    const recipe = input.recipes.recipes.find((entry) => entry.recipeId === input.requestedRecipeId);
    if (!recipe) {
      throw new CliError('ATM_TEAM_RECIPE_NOT_FOUND', `Team recipe not found: ${input.requestedRecipeId}`, {
        exitCode: 2,
        details: { availableRecipeIds: input.recipes.recipes.map((entry) => entry.recipeId) }
      });
    }
    return recipe;
  }
  const language = inferTaskLanguage(input.task);
  return input.recipes.recipes.find((entry) => entry.language === language)
    ?? input.recipes.recipes.find((entry) => entry.recipeId === 'atm.default.normal.typescript')
    ?? input.recipes.recipes[0];
}

function inferTaskLanguage(task: Record<string, unknown> | null | undefined) {
  const paths = collectTaskPathHints(task);
  if (paths.some((entry) => entry.endsWith('.py') || entry.includes('pipelines/'))) return 'python';
  if (paths.some((entry) => entry.endsWith('.cs'))) return 'csharp';
  return 'typescript';
}

export function resolveTeamPlanActorId(input: {
  cwd: string;
  taskId: string;
  explicitActorId?: string;
  fallbackActorId?: string;
}): string {
  const explicit = String(input.explicitActorId ?? '').trim();
  if (explicit) {
    return explicit;
  }
  const claimActor = readActiveTaskClaimActorId(input.cwd, input.taskId);
  if (claimActor) {
    return claimActor;
  }
  return String(input.fallbackActorId ?? '').trim() || 'team-planner';
}

export function readActiveTaskClaimActorId(cwd: string, taskId: string): string | null {
  try {
    const task = readTask(cwd, taskId);
    const claim = task.claim && typeof task.claim === 'object' ? task.claim as Record<string, unknown> : null;
    if (!claim || String(claim.state ?? '').trim() !== 'active') {
      return null;
    }
    const actorId = String(claim.actorId ?? '').trim();
    if (!actorId) {
      return null;
    }
    const heartbeatAt = String(claim.heartbeatAt ?? claim.claimedAt ?? '').trim();
    const ttlSeconds = Number(claim.ttlSeconds ?? 0);
    if (heartbeatAt && Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
      const heartbeatMs = Date.parse(heartbeatAt);
      if (Number.isFinite(heartbeatMs) && Date.now() - heartbeatMs > ttlSeconds * 1000) {
        return null;
      }
    }
    return actorId;
  } catch {
    return null;
  }
}

export function planTeamBrokerLane(input: {
  cwd: string;
  taskId: string;
  actorId: string;
  task: Record<string, unknown> | null | undefined;
  writePaths: string[];
  readOnly?: boolean;
}) {
  const brokerLaneResult = evaluateTeamBrokerLane({
    cwd: input.cwd,
    taskId: input.taskId,
    actorId: input.actorId,
    task: input.task,
    writePaths: input.writePaths,
    readOnly: input.readOnly === true
  });
  const findings = brokerLaneToFindings(brokerLaneResult).map((finding) => buildPermissionFinding({
    level: finding.level,
    code: finding.code,
    detail: finding.detail,
    paths: finding.paths
  })) satisfies PermissionFinding[];
  return {
    result: brokerLaneResult,
    evidence: buildTeamBrokerEvidence(brokerLaneResult),
    findings: [
      ...findings,
      ...buildProposalFirstParityFindings({
        taskId: input.taskId,
        brokerLaneResult,
        advisoryOnly: input.readOnly === true
      })
    ]
  };
}

export function buildTeamPlan(input: {
  cwd?: string;
  task: Record<string, unknown> | null | undefined;
  recipe: TeamRecipe;
  writePaths: string[];
  validation: { ok: boolean; findings: PermissionFinding[] };
  brokerLane: TeamBrokerLaneEvidence;
  gitIndexOwnership?: GitIndexOwnershipReport;
  allowEmptyWriteScope?: boolean;
  requestedTeamSize?: string;
  providerSelectionConfig?: TeamProviderSelectionConfig | null;
  providerSelectionSource?: { schemaId: 'atm.teamAgentsConfig.v1'; path: string | null; loaded: boolean; cliOverrideCount: number } | null;
  knowledgeSummary?: TeamKnowledgeSummary;
}) {
  const atomizationChecklist = buildAtomizationChecklist(input.task, input.writePaths);
  const crewBriefingContract = buildMinimalTaskCrewBriefingContract(input.task, input.writePaths, input.validation, input.brokerLane);
  const implementerSelector = selectTeamImplementer(input.task, input.recipe, input.writePaths);
  const captainDecision = buildCaptainDecision(input.task, input.writePaths, input.validation, input.brokerLane, crewBriefingContract, atomizationChecklist, implementerSelector, input.requestedTeamSize);
  const activeTeamLevel = captainDecision.teamLevel ?? mapTeamSizeToLevel(captainDecision.teamSize);
  const rosterProjection = projectTeamRecipeForLevel(input.recipe, activeTeamLevel);
  const activeRecipe = rosterProjection.recipe;
  const roleSkillPacks = buildTeamRoleSkillPackContract(activeRecipe);
  const roleSkillPackManifest = buildProviderNeutralRoleSkillPackManifest({
    recipe: activeRecipe,
    roleSkillPacks,
    selectionConfig: input.providerSelectionConfig ?? undefined
  });
  const routingMatrix = buildTeamRoleRoutingMatrix(roleSkillPacks);
  const growthContract = buildTeamGrowthContract();
  const observabilityContract = buildTeamObservabilityContract();
  const roleGrowthObservabilityContract = buildTeamRoleGrowthObservabilityContract({
    roleSkillPacks,
    growthContract
  });
  const runtimeTierContract = buildRuntimeTierContract(activeRecipe);
  const runtimePilot = buildTeamRuntimePilot({
    roleSkillPacks,
    routingMatrix,
    growthContract,
    validation: input.validation,
    brokerLane: input.brokerLane
  });
  const shadowSchedule = buildTeamShadowScheduleForPlan({
    cwd: input.cwd ?? process.cwd(),
    task: input.task,
    recipe: activeRecipe,
    writePaths: input.writePaths,
    captainDecision,
    validation: input.validation,
    brokerLane: input.brokerLane
  });
  const governanceRuntime = buildTeamGovernanceRuntimeFields({
    validation: input.validation,
    brokerLane: input.brokerLane,
    runtimePilot,
    captainDecision
  });
  return {
    schemaId: 'atm.teamPlan.v1',
    recipeId: activeRecipe.recipeId,
    channelHint: 'normal',
    teamLevel: activeTeamLevel,
    rosterProjection: rosterProjection.projection,
    governanceRuntime,
    decisionClass: governanceRuntime.decisionClass,
    decisionReason: governanceRuntime.decisionReason,
    requiresHumanSignoff: governanceRuntime.requiresHumanSignoff,
    requiresAdr: governanceRuntime.requiresAdr,
    violationStatus: governanceRuntime.violationStatus,
    escalationTarget: governanceRuntime.escalationTarget,
    providerSelectionSource: input.providerSelectionSource ?? null,
    brokerLane: input.brokerLane,
    indexLane: input.gitIndexOwnership?.indexLane ?? {
      schemaId: 'atm.gitIndexLane.v1',
      status: 'free',
      ownerTaskId: null,
      ownerActorId: null,
      reason: 'Git index ownership was not inspected for this team plan.'
    },
    gitIndexOwnership: input.gitIndexOwnership ?? null,
    agents: activeRecipe.agents,
    captainDecision,
    implementerSelector,
    roleSkillPacks,
    roleSkillPackManifest,
    routingMatrix,
    growthContract,
    observabilityContract,
    roleGrowthObservabilityContract,
    runtimeTierContract,
    shadowSchedule,
    openAIFamilyRuntimeBridges: buildOpenAIFamilyRuntimeBridgeSummary(),
    editorExecutionRuntimeBridges: buildEditorExecutionRuntimeBridgeSummary(),
    microsoftFoundryRuntimeBridges: buildMicrosoftFoundryRuntimeBridgeSummary(),
    anthropicRuntimeBridges: buildAnthropicRuntimeBridgeSummary(),
    runtimePilot,
    ...(input.knowledgeSummary ? { knowledgeSummary: input.knowledgeSummary } : {}),
    requiredRoles: crewBriefingContract.requiredRoles,
    optionalRoles: crewBriefingContract.optionalRoles,
    briefingContract: crewBriefingContract,
    atomizationPlannerRole: {
      role: 'atomizationPlanner',
      agentIds: input.recipe.agents.filter((agent) => agent.role === 'atomizationPlanner').map((agent) => agent.agentId),
      permissions: input.recipe.agents.find((agent) => agent.role === 'atomizationPlanner')?.permissions ?? []
    },
    atomizationChecklist,
    suggestedPermissionLeases: buildSuggestedPermissionLeases(input.recipe, input.writePaths, { allowEmptyWriteScope: input.allowEmptyWriteScope }),
    nextSteps: [
      'Review this dry-run plan.',
      'Run team start when you want a runtime team run record.',
      'Do not hand-edit .atm/runtime team state.'
    ],
    validation: input.validation
  };
}

export function buildTeamRuntimePilot(input: {
  roleSkillPacks: TeamRoleSkillPackContract;
  routingMatrix: TeamRoleRoutingMatrix;
  growthContract: TeamGrowthContract;
  validation: { ok: boolean; findings: PermissionFinding[] };
  brokerLane: TeamBrokerLaneEvidence;
}): TeamRuntimePilot {
  const orderedRoles = ['coordinator', 'implementer', 'validator'];
  const selectedRoles = orderedRoles.filter((role) => input.roleSkillPacks.roles.some((entry) => entry.role === role));
  const pilotRoles = selectedRoles.length >= 3 ? selectedRoles.slice(0, 3) : selectedRoles.slice(0, 2);
  const selectedEntries = input.roleSkillPacks.roles.filter((entry) => pilotRoles.includes(entry.role));
  const blockedByBroker = input.brokerLane.safeToStart === false;
  const brokerViolationStatus = blockedByBroker
    ? input.brokerLane.decision.admission?.state === 'proposal-submitted'
      ? 'proposal-submitted'
      : 'broker-conflict-blocked'
    : 'none';
  const brokerConflictVocabulary = {
    decisionClass: blockedByBroker ? 'blocked' : 'auto-execution',
    decisionReason: input.brokerLane.blockedReasons[0] ?? input.brokerLane.decision.reason ?? 'Team Broker allowed the runtime pilot lane.',
    violationStatus: blockedByBroker
      ? brokerViolationStatus === 'proposal-submitted'
        ? 'proposal-submitted'
        : 'broker-conflict-blocked'
      : 'none',
    blockedCode: blockedByBroker && brokerViolationStatus !== 'proposal-submitted' ? 'broker-conflict-blocked' : null
  } satisfies TeamRuntimePilot['brokerConflictVocabulary'];
  const actionableRefinementFindings = [
    ...input.validation.findings.map((finding) => ({
      category: classifyTeamPilotFinding(finding.code),
      summary: finding.summary,
      detail: finding.detail,
      correctRoute: 'Keep Coordinator authority primary, resolve lease or scope blockers first, then rerun team validate or team start.',
      promotionTarget: input.growthContract.promotionPolicy.rawCaseTarget
    })),
    ...normalizeTeamBrokerPilotFindings(input.brokerLane, input.growthContract.promotionPolicy.rawCaseTarget)
  ];
  return {
    schemaId: 'atm.teamRuntimePilot.v1',
    providerNeutral: true,
    coordinatorOwnsLifecycle: true,
    pilotMode: pilotRoles.length >= 3 ? 'role-trio' : 'role-pair',
    selectedRoles: pilotRoles,
    selectedSkillPackIds: selectedEntries.map((entry) => entry.skillPackId),
    agentSkillUnits: selectedEntries.map((entry) => ({
      role: entry.role,
      agentId: entry.agentId,
      skillPackId: entry.skillPackId,
      boundedSkillPackLoaded: true,
      permissionLease: {
        allowedPermissions: entry.allowedPermissions,
        forbiddenPermissions: entry.forbiddenPermissions
      },
      playbookSlice: entry.playbookSlice,
      lifecycleAuthority: entry.role === 'coordinator' ? 'coordinator-owned' : 'worker-forbidden'
    })),
    realisticWorkflow: [
      'Coordinator routes the task and remains the only lifecycle and git.write owner.',
      'Implementer loads only the scoped delivery pack for the active workstream.',
      'Validator loads only validator-evidence guidance and returns findings to Coordinator.'
    ],
    workflowEvidence: {
      scenarioId: 'agent-plus-skill-runtime-pilot',
      roleOrder: input.routingMatrix.routes.find((route) => route.workstream === 'scoped-implementation')?.roleOrder ?? pilotRoles,
      coordinatorOnlyLifecyclePreserved: true,
      workerWriteScope: 'bounded-by-task-lease',
      blockedByBroker,
      brokerViolationStatus
    },
    roleBoundarySignals: [
      ...selectedEntries.map((entry) => `${entry.role} -> ${entry.playbookSlice}`),
      ...input.routingMatrix.routes
        .filter((route) => ['task-entry-routing', 'scoped-implementation', 'validation-and-evidence'].includes(route.workstream))
        .map((route) => `${route.workstream}: ${route.primaryRole}`)
    ],
    lifecycleAuthority: {
      ownerRole: 'coordinator',
      forbiddenToWorkers: ['task.lifecycle', 'git.write', 'self-close']
    },
    roleConfusionReduction: [
      'Each pilot role loads only its bounded skill pack instead of a monolithic governance skill.',
      'Workers return findings or diffs to Coordinator instead of widening into closeout authority.',
      'Growth lessons land in a shared taxonomy without contaminating unrelated role packs.'
    ],
    roleConfusionMetrics: {
      baselineLoadedSkillPacks: 'monolithic-team-context',
      pilotLoadedSkillPacks: selectedEntries.map((entry) => entry.skillPackId),
      preventedPermissionDrift: uniqueStrings(selectedEntries.flatMap((entry) => entry.forbiddenPermissions)),
      refinementSignalCount: actionableRefinementFindings.length
    },
    roleGrowthObservability: {
      contractSchemaId: 'atm.teamRoleGrowthObservabilityContract.v1',
      eventType: 'artifact.output',
      artifactType: 'atm.teamRoleGrowthLearningItem.v1',
      frictionDimensions: ['shared-atm-routing-friction', 'role-specific-friction'],
      brokerConflictBlockedMetricId: 'broker-conflict-blocked.hit-rate',
      roleContractMappings: selectedEntries.map((entry) => ({
        role: entry.role,
        skillPackId: entry.skillPackId,
        playbookSlice: entry.playbookSlice
      }))
    },
    brokerConflictVocabulary,
    actionableRefinementFindings
  };
}

function buildTeamGovernanceRuntimeFields(input: {
  validation: { ok: boolean; findings: PermissionFinding[] };
  brokerLane: TeamBrokerLaneEvidence;
  runtimePilot: TeamRuntimePilot;
  captainDecision: ReturnType<typeof buildCaptainDecision>;
}): TeamGovernanceRuntimeFields {
  const blockingFinding = input.validation.findings.find((finding) => finding.level === 'error') ?? null;
  const blockedByBroker = input.runtimePilot.brokerConflictVocabulary.violationStatus === 'broker-conflict-blocked'
    || input.brokerLane.safeToStart === false;
  const brokerVerdict = String(input.brokerLane.decision.verdict ?? '');
  const escalationRequired = input.captainDecision.escalationRequired === true
    || brokerVerdict === 'needs-steward'
    || brokerVerdict === 'historical-delivery-required';
  const requiresAdr = brokerVerdict === 'needs-steward'
    || normalizeStringArray(input.brokerLane.blockedReasons).some((reason) => reason.toLowerCase().includes('adr'));
  const requiresHumanSignoff = escalationRequired || requiresAdr;
  const decisionClass = blockedByBroker || blockingFinding
    ? 'blocked'
    : requiresAdr
      ? 'adr-required'
      : requiresHumanSignoff
        ? 'human-signoff-required'
        : 'auto-execution';
  const decisionReason = blockingFinding?.summary
    ?? input.runtimePilot.brokerConflictVocabulary.decisionReason
    ?? input.captainDecision.reason;
  const violationStatus = blockedByBroker
    ? 'broker-conflict-blocked'
    : blockingFinding
      ? 'blocked'
      : requiresAdr
        ? 'adr-required'
        : requiresHumanSignoff
          ? 'human-signoff-required'
          : 'none';
  return {
    schemaId: 'atm.teamGovernanceRuntimeFields.v1',
    decisionClass,
    decisionReason,
    requiresHumanSignoff,
    requiresAdr,
    violationStatus,
    escalationTarget: requiresHumanSignoff
      ? (requiresAdr ? 'ADR + Captain review' : 'Captain / human review')
      : null
  };
}

export function evaluateReviewerIndependence(input: {
  implementer: ReviewerIdentity;
  reviewer: ReviewerIdentity;
  policy: 'different-provider' | 'different-model-family' | 'different-certification';
}) {
  const implementerFamily = normalizeModelFamily(input.implementer.modelId);
  const reviewerFamily = normalizeModelFamily(input.reviewer.modelId);
  const checks = {
    differentProvider: input.implementer.providerId !== input.reviewer.providerId,
    differentModelFamily: implementerFamily !== reviewerFamily,
    differentCertification: Boolean(input.implementer.modelCertificationId)
      && Boolean(input.reviewer.modelCertificationId)
      && input.implementer.modelCertificationId !== input.reviewer.modelCertificationId
  };
  const ok = input.policy === 'different-provider'
    ? checks.differentProvider
    : input.policy === 'different-model-family'
      ? checks.differentModelFamily
      : checks.differentCertification;
  return {
    schemaId: 'atm.reviewerIndependenceDecision.v1',
    ok,
    policy: input.policy,
    checks,
    reason: ok
      ? `Reviewer satisfies ${input.policy}.`
      : `Reviewer does not satisfy ${input.policy}; advisory note only.`
  };
}

export function buildReviewAgentSignature(input: {
  taskId: string;
  reviewer: ReviewerIdentity;
  implementer: ReviewerIdentity;
  reviewedDiffHash: string;
  policy: 'different-provider' | 'different-model-family' | 'different-certification';
  findings?: readonly string[];
}) {
  const independence = evaluateReviewerIndependence({
    implementer: input.implementer,
    reviewer: input.reviewer,
    policy: input.policy
  });
  const certificationPresent = Boolean(input.reviewer.modelCertificationId);
  const formal = independence.ok && certificationPresent;
  return {
    schemaId: 'atm.reviewAgentSignature.v1',
    taskId: input.taskId,
    signatureStatus: formal ? 'formal-signature' : 'advisory-note',
    permission: formal ? 'review.signature.write' : null,
    reviewer: {
      providerId: input.reviewer.providerId,
      modelId: input.reviewer.modelId,
      modelCertificationId: input.reviewer.modelCertificationId ?? null
    },
    implementer: {
      providerId: input.implementer.providerId,
      modelId: input.implementer.modelId,
      modelCertificationId: input.implementer.modelCertificationId ?? null
    },
    modelCertificationId: input.reviewer.modelCertificationId ?? null,
    reviewerIndependencePolicy: input.policy,
    independence,
    reviewedDiffHash: input.reviewedDiffHash,
    findings: [...(input.findings ?? [])],
    earlyWarning: classifyReviewEarlyWarnings(input.findings ?? [])
  };
}

export function evaluateReviewQuorum(input: {
  signatures: readonly ReturnType<typeof buildReviewAgentSignature>[];
  requiredFormalSignatures: number;
}) {
  const formal = input.signatures.filter((signature) => signature.signatureStatus === 'formal-signature');
  const conflicts = detectReviewSignatureConflicts(input.signatures);
  const ok = formal.length >= input.requiredFormalSignatures && conflicts.length === 0;
  return {
    schemaId: 'atm.reviewQuorumDecision.v1',
    ok,
    requiredFormalSignatures: input.requiredFormalSignatures,
    formalSignatureCount: formal.length,
    advisoryNoteCount: input.signatures.length - formal.length,
    conflicts,
    escalationTarget: ok ? null : 'Coordinator/Captain/human review',
    reason: ok
      ? 'Review quorum satisfied.'
      : 'Review quorum insufficient or conflicting; formal signature is blocked but advisory notes remain usable.'
  };
}

function normalizeModelFamily(modelId: string) {
  return String(modelId ?? '').trim().toLowerCase().split(/[-_.:]/)[0] || 'unknown';
}

function classifyReviewEarlyWarnings(findings: readonly string[]) {
  return findings.map((finding) => {
    const normalized = finding.toLowerCase();
    const category = normalized.includes('scope')
      ? 'scope-drift'
      : normalized.includes('test')
        ? 'missing-tests'
        : normalized.includes('contract')
          ? 'consumer-contract'
          : normalized.includes('rollback')
            ? 'rollback-gap'
            : 'review-note';
    return { category, finding };
  });
}

function detectReviewSignatureConflicts(signatures: readonly ReturnType<typeof buildReviewAgentSignature>[]) {
  const findingSets = signatures.map((signature) => new Set(signature.findings.map((finding) => finding.toLowerCase())));
  const conflicts: string[] = [];
  for (let index = 1; index < findingSets.length; index += 1) {
    const previous = findingSets[index - 1];
    const current = findingSets[index];
    if (previous.has('approve') && current.has('block') || previous.has('block') && current.has('approve')) {
      conflicts.push(`reviewer-${index}-decision-conflict`);
    }
  }
  return conflicts;
}

function buildCaptainDecision(
  task: Record<string, unknown> | null | undefined,
  writePaths: string[],
  validation: { ok: boolean; findings: PermissionFinding[] },
  brokerLane: TeamBrokerLaneEvidence,
  crewBriefingContract: ReturnType<typeof buildMinimalTaskCrewBriefingContract>,
  atomizationChecklist: ReturnType<typeof buildAtomizationChecklist>,
  implementerSelector: TeamImplementerSelector,
  requestedTeamSize?: string
) {
  const automaticSizing = decideTeamSizing(task, writePaths, validation, brokerLane);
  const manualSizing = normalizeTeamSizeOverride(requestedTeamSize);
  const sizing = manualSizing
    ? {
      teamSize: manualSizing.teamSize,
      confidence: 'high',
      reason: `Manual team size override ${manualSizing.teamLevel} selected by CLI/config.`
    }
    : automaticSizing;
  const lieutenantEscalation = assessLieutenantEscalation(task, writePaths, validation, brokerLane, atomizationChecklist);
  return {
    schemaId: 'atm.teamCaptainDecision.v1',
    captain: {
      role: 'Task Captain',
      agentId: 'coordinator'
    },
    taskId: crewBriefingContract.taskId,
    authorityChain: {
      broker: 'Broker verdicts override Coordinator decisions inside broker-governed conflict domains.',
      coordinator: 'Coordinator retains team-local lifecycle authority outside broker-governed conflict domains.'
    },
    conflictRules: [
      'If broker verdict is needs-steward, blocked-cid-conflict, blocked-shared-surface, or historical-delivery-required, Coordinator must stop claim / commit / close progression.',
      'If broker-prescribed routing exceeds task scope, closure authority, or task-card acceptance, Coordinator must escalate to Captain / human.',
      'Coordinator must not silently override broker verdicts inside broker-governed conflict domains.'
    ],
    teamLevel: manualSizing?.teamLevel ?? mapTeamSizeToLevel(sizing.teamSize),
    teamLevelSource: manualSizing ? 'manual' : 'automatic',
    teamSize: sizing.teamSize,
    requiredRoles: crewBriefingContract.requiredRoles.map((role) => role.role),
    optionalRoles: crewBriefingContract.optionalRoles.map((role) => role.role),
    reason: sizing.reason,
    confidence: sizing.confidence,
    implementerSelector,
    stopConditions: crewBriefingContract.stopConditions,
    escalationRequired: lieutenantEscalation.escalationRequired,
    escalationReason: lieutenantEscalation.escalationReason,
    needLieutenant: lieutenantEscalation.needLieutenant,
    nextTeamShape: lieutenantEscalation.nextTeamShape,
    decisionSurface: {
      validationOk: validation.ok,
      brokerVerdict: brokerLane.decision.verdict,
      largeScriptRisk: atomizationChecklist.largeScriptRisk,
      mapUpdateNeed: atomizationChecklist.mapUpdateNeed,
      escalationRequired: lieutenantEscalation.escalationRequired,
      needLieutenant: lieutenantEscalation.needLieutenant,
      authorityChain: 'Broker overrides Coordinator inside broker-governed conflict domains; Coordinator remains local outside them.'
    }
  };
}

function normalizeTeamSizeOverride(value: unknown): { teamLevel: TeamLevel; teamSize: 'small' | 'medium' | 'large' } | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'small' || normalized === 'l1') return { teamLevel: 'L1', teamSize: 'small' };
  if (normalized === 'medium' || normalized === 'normal' || normalized === 'l2') return { teamLevel: 'L2', teamSize: 'medium' };
  if (normalized === 'large' || normalized === 'l3') return { teamLevel: 'L3', teamSize: 'large' };
  if (normalized === 'l4') return { teamLevel: 'L4', teamSize: 'large' };
  if (normalized === 'l5') return { teamLevel: 'L5', teamSize: 'large' };
  throw new CliError('ATM_TEAM_SIZE_INVALID', `Unsupported team size override: ${value}`, {
    exitCode: 2,
    details: { supported: ['small', 'medium', 'large', 'L1', 'L2', 'L3', 'L4', 'L5'] }
  });
}

function mapTeamSizeToLevel(value: unknown): TeamLevel {
  const normalized = String(value ?? '').trim();
  if (normalized === 'large') return 'L3';
  if (normalized === 'medium') return 'L2';
  return 'L1';
}

function projectTeamRecipeForLevel(recipe: TeamRecipe, teamLevel: TeamLevel) {
  const targetRoles = teamRosterLevelRoles[teamLevel];
  const agentsByRole = new Map(recipe.agents.map((agent) => [agent.role, agent]));
  const agents = targetRoles
    .map((role) => agentsByRole.get(role) ?? teamRosterSyntheticAgents[role] ?? null)
    .filter((agent): agent is TeamRecipeAgent => agent !== null);
  const activeRoles = agents.map((agent) => agent.role);
  const deferredRoles = recipe.agents
    .map((agent) => agent.role)
    .filter((role) => !activeRoles.includes(role));
  const syntheticRoles = activeRoles.filter((role) => !recipe.agents.some((agent) => agent.role === role));
  return {
    recipe: {
      ...recipe,
      agents
    },
    projection: {
      schemaId: 'atm.teamRosterProjection.v1',
      teamLevel,
      teamSize: teamLevel === 'L1' ? 'small' : teamLevel === 'L2' ? 'medium' : 'large',
      activeRoles,
      syntheticRoles,
      deferredRoles,
      catalogReadyRosterDeferredRoles,
      roleRules: {
        L1: 'Core four: Coordinator, Atomization Planner, Implementer, Validator.',
        L2: 'Normal crew: L1 plus Reader and Evidence Collector.',
        L3: 'Large crew: L2 plus Scope Guardian.',
        L4: 'Escalated crew: L3 plus Lieutenant coordination boundary.',
        L5: 'Full advisory crew: L4 plus Review Agent and Knowledge Scout.'
      }
    }
  };
}

export function selectTeamImplementer(task: Record<string, unknown> | null | undefined, recipe: TeamRecipe, writePaths: string[]): TeamImplementerSelector {
  const deterministicHints = collectImplementerHints(task, writePaths);
  const implementers = recipe.agents
    .filter((agent) => isImplementerAgent(agent))
    .sort((left, right) => left.agentId.localeCompare(right.agentId));
  const pythonImplementers = implementers.filter((agent) => matchesImplementerLanguage(agent, 'python'));
  const typescriptImplementers = implementers.filter((agent) => matchesImplementerLanguage(agent, 'typescript'));
  const uiImplementers = implementers.filter((agent) => matchesUiImplementer(agent));

  const selected = pickImplementerCandidate({
    implementers,
    pythonImplementers,
    typescriptImplementers,
    uiImplementers,
    deterministicHints,
    recipeId: recipe.recipeId
  });

  return {
    schemaId: 'atm.teamImplementerSelector.v1',
    ...selected,
    deterministicHints
  };
}

function pickImplementerCandidate(input: {
  implementers: TeamRecipeAgent[];
  pythonImplementers: TeamRecipeAgent[];
  typescriptImplementers: TeamRecipeAgent[];
  uiImplementers: TeamRecipeAgent[];
  deterministicHints: TeamImplementerSelector['deterministicHints'] & {
    pythonHeavy: boolean;
    typescriptHeavy: boolean;
    uiPaths: boolean;
  };
  recipeId: string;
}) {
  const { deterministicHints, recipeId } = input;
  const genericImplementer = input.implementers.find((agent) => agent.language === 'generic') ?? {
    agentId: 'implementer-generic',
    role: 'implementer',
    profile: 'atm.implementer.generic.v1',
    language: 'generic',
    permissions: ['file.write']
  };

  if (deterministicHints.pythonHeavy && input.pythonImplementers.length > 0) {
    return buildSelectorResult(input.pythonImplementers[0], recipeId, 'python', 'python-implementer', 'No fallback needed; Python-heavy paths matched a Python implementer.', 'high');
  }

  if (deterministicHints.uiPaths && input.uiImplementers.length > 0) {
    return buildSelectorResult(input.uiImplementers[0], recipeId, inferSelectorLanguage(input.uiImplementers[0]), 'ui-implementer', 'No fallback needed; adopter UI path hints matched a UI-oriented implementer.', input.uiImplementers[0].language ? 'high' : 'medium');
  }

  if (deterministicHints.typescriptHeavy && input.typescriptImplementers.length > 0) {
    return buildSelectorResult(input.typescriptImplementers[0], recipeId, 'typescript', 'typescript-implementer', 'No fallback needed; TypeScript-heavy paths matched a TypeScript implementer.', 'high');
  }

  const fallbackRoleMatch = deterministicHints.uiPaths
    ? 'ui-implementer'
    : deterministicHints.pythonHeavy
      ? 'python-implementer'
      : deterministicHints.typescriptHeavy
        ? 'typescript-implementer'
        : 'generic-implementer';

  const fallbackReason = deterministicHints.pythonHeavy
    ? `Python-heavy paths were detected, but the selected recipe only exposed ${genericImplementer.agentId} as the available implementer.`
    : deterministicHints.uiPaths
      ? `Adopter UI path hints were detected, but the selected recipe only exposed ${genericImplementer.agentId} as the available implementer.`
      : deterministicHints.typescriptHeavy
        ? `TypeScript-heavy paths were detected, but the selected recipe only exposed ${genericImplementer.agentId} as the available implementer.`
        : `No specific language or UI hint dominated, so ${genericImplementer.agentId} was selected as the generic implementer.`;

  return buildSelectorResult(
    genericImplementer,
    recipeId,
    inferSelectorLanguage(genericImplementer),
    fallbackRoleMatch,
    fallbackReason,
    deterministicHints.pythonHeavy || deterministicHints.typescriptHeavy || deterministicHints.uiPaths ? 'medium' : 'low'
  );
}

function buildSelectorResult(
  agent: TeamRecipeAgent,
  recipeId: string,
  languageMatch: TeamImplementerSelector['languageMatch'],
  roleMatch: TeamImplementerSelector['roleMatch'],
  fallbackReason: string,
  confidence: TeamImplementerSelector['confidence']
) {
  return {
    selectedImplementer: {
      agentId: agent.agentId,
      role: agent.role,
      profile: agent.profile,
      language: agent.language,
      recipeId
    },
    languageMatch,
    roleMatch,
    fallbackReason,
    confidence
  };
}

function collectImplementerHints(task: Record<string, unknown> | null | undefined, writePaths: string[]) {
  const scopePaths = uniqueStrings([
    ...normalizeTaskPathArray(task?.scopePaths),
    ...normalizeTaskPathArray(task?.targetAllowedFiles),
    ...writePaths
  ]);
  const deliverables = uniqueStrings(normalizeTaskPathArray(task?.deliverables));
  const allPaths = uniqueStrings([...scopePaths, ...deliverables]);
  const fileExtensions = uniqueStrings(
    allPaths
      .map((entry) => path.posix.extname(entry.replace(/\\/g, '/')).toLowerCase())
      .filter(Boolean)
  );
  const pathHints = uniqueStrings([
    ...(allPaths.some((entry) => /\.pyi?$/i.test(entry)) ? ['python-heavy'] : []),
    ...(allPaths.some((entry) => /\.(ts|tsx|mts|cts)$/i.test(entry)) ? ['typescript-heavy'] : []),
    ...(allPaths.some((entry) => /(^|\/)(ui|editor|panel|view|scene|adopter|components?)(\/|$)/i.test(entry)) ? ['adopter-ui'] : []),
    ...pathHintsFromPaths(allPaths)
  ]);
  return {
    scopePaths,
    deliverables,
    fileExtensions,
    pathHints,
    pythonHeavy: allPaths.some((entry) => /\.pyi?$/i.test(entry)),
    typescriptHeavy: allPaths.some((entry) => /\.(ts|tsx|mts|cts)$/i.test(entry)),
    uiPaths: allPaths.some((entry) => /(^|\/)(ui|editor|panel|view|scene|adopter|components?)(\/|$)/i.test(entry))
  };
}

function pathHintsFromPaths(paths: string[]) {
  const hints: string[] = [];
  for (const entry of paths) {
    const normalized = entry.replace(/\\/g, '/').toLowerCase();
    if (normalized.includes('/packages/cli/src/commands/')) hints.push('cli-command-surface');
    if (normalized.includes('/scripts/')) hints.push('script-surface');
    if (normalized.includes('/assets/')) hints.push('asset-surface');
    if (normalized.includes('/ui/') || normalized.includes('/editor/')) hints.push('adopter-ui');
    if (normalized.endsWith('.py') || normalized.endsWith('.pyi')) hints.push('python-file');
    if (normalized.endsWith('.ts') || normalized.endsWith('.tsx') || normalized.endsWith('.mts') || normalized.endsWith('.cts')) hints.push('typescript-file');
  }
  return hints;
}

function isImplementerAgent(agent: TeamRecipeAgent) {
  return /implementer/i.test(agent.role)
    || /implementer/i.test(agent.agentId)
    || /implementer/i.test(agent.profile ?? '')
    || agent.permissions.includes('file.write');
}

function matchesImplementerLanguage(agent: TeamRecipeAgent, language: 'typescript' | 'python') {
  const value = [agent.language, agent.profile, agent.agentId, agent.role].filter(Boolean).join(' ').toLowerCase();
  return value.includes(language);
}

function matchesUiImplementer(agent: TeamRecipeAgent) {
  const value = [agent.role, agent.profile, agent.agentId].filter(Boolean).join(' ').toLowerCase();
  return value.includes('ui') || value.includes('editor');
}

function inferSelectorLanguage(agent: TeamRecipeAgent) {
  if (matchesImplementerLanguage(agent, 'python')) return 'python' as const;
  if (matchesImplementerLanguage(agent, 'typescript')) return 'typescript' as const;
  return 'unknown' as const;
}

export function assessLieutenantEscalation(
  task: Record<string, unknown> | null | undefined,
  writePaths: string[],
  validation: { ok: boolean; findings: PermissionFinding[] },
  brokerLane: TeamBrokerLaneEvidence,
  atomizationChecklist: ReturnType<typeof buildAtomizationChecklist>
) {
  const taskId = String(task?.workItemId ?? task?.taskId ?? '').trim();
  const normalizedTitle = String(task?.title ?? '').toLowerCase();
  const scopePaths = uniqueStrings([
    ...normalizeTaskPathArray(task?.scopePaths),
    ...normalizeTaskPathArray(task?.deliverables),
    ...normalizeTaskPathArray(task?.targetAllowedFiles)
  ]);
  const scopeCount = scopePaths.length;
  const taskRepo = String(task?.targetRepo ?? task?.planningRepo ?? '').trim();
  const planningRepo = String(task?.planningRepo ?? '').trim();
  const crossRepoScope = Boolean(taskRepo && planningRepo && taskRepo !== planningRepo);
  const validatorCount = uniqueStrings([
    ...normalizeStringArray(task?.validators),
    ...normalizeStringArray(task?.acceptance)
  ]).length;
  const closureSignals = Boolean(
    uniqueStrings([
      ...normalizeTaskPathArray(task?.scopePaths),
      ...normalizeTaskPathArray(task?.deliverables)
    ]).some((entry) => /closure|evidence|git/i.test(entry))
    || /closure|evidence|git/i.test(normalizedTitle)
  );
  const largeScriptRisk = atomizationChecklist.largeScriptRisk.level === 'high';
  const validationHasBlockingFinding = validation.findings.some((finding) => finding.level === 'error');
  const brokerRequiresCoordination = brokerLane.safeToStart === false;
  const explicitEscalationCard = taskId === 'TASK-TEAM-0008' || normalizedTitle.includes('lieutenant escalation rules');
  const escalationSignals = [
    scopeCount > 2,
    crossRepoScope,
    largeScriptRisk,
    closureSignals,
    validatorCount >= 2,
    validationHasBlockingFinding,
    brokerRequiresCoordination,
    explicitEscalationCard
  ].filter(Boolean).length;

  const escalationRequired = explicitEscalationCard || escalationSignals >= 2;
  const needLieutenant = escalationRequired;
  const escalationReason = escalationRequired
    ? [
        explicitEscalationCard ? 'This card explicitly governs lieutenant escalation rules.' : null,
        scopeCount > 2 ? `Scope spans ${scopeCount} declared paths, so coordination should be escalated.` : null,
        crossRepoScope ? 'Scope crosses repo boundaries and should retain a lieutenant coordination boundary.' : null,
        largeScriptRisk ? 'Large script risk indicates the captain should not keep all coordination signals inline.' : null,
        closureSignals ? 'Closure, evidence, or git signals are present and should be tracked by a lieutenant boundary.' : null,
        validatorCount >= 2 ? `Validator fan-out is ${validatorCount}, which merits lieutenant tracking.` : null,
        validationHasBlockingFinding ? 'Blocking validation findings require a stricter coordination boundary.' : null,
        brokerRequiresCoordination ? `Broker verdict is ${brokerLane.decision.verdict}, so the lane is not trivially safe-to-start.` : null
      ].filter(Boolean).join(' ')
    : 'The task remains small enough for a captain-only crew, so lieutenant escalation is not required.';

  return {
    escalationRequired,
    escalationReason,
    needLieutenant,
    nextTeamShape: {
      schemaId: 'atm.teamLieutenantEscalationShape.v1',
      captain: {
        role: 'Task Captain',
        permissions: ['task.lifecycle', 'git.write', 'evidence.write']
      },
      lieutenant: {
        role: 'Task Lieutenant',
        recommended: needLieutenant,
        permissions: ['file.read', 'exec.validator'],
        forbiddenPermissions: ['task.lifecycle', 'git.write', 'evidence.write'],
        coordinationFocus: ['phase coordination', 'blocker tracking', 'handoff summarization']
      },
      teamSizeHint: needLieutenant ? 'medium' : 'small',
      coordinationBoundary: needLieutenant ? 'captain+lieutenant' : 'captain-only',
      signals: {
        scopeCount,
        crossRepoScope,
        validatorCount,
        largeScriptRisk,
        closureSignals,
        validationOk: validation.ok,
        brokerVerdict: brokerLane.decision.verdict
      },
      suggestedPermissions: {
        captain: ['task.lifecycle', 'git.write', 'evidence.write'],
        lieutenant: ['file.read', 'exec.validator']
      }
    }
  };
}

function decideTeamSizing(
  task: Record<string, unknown> | null | undefined,
  writePaths: string[],
  validation: { ok: boolean; findings: PermissionFinding[] },
  brokerLane: TeamBrokerLaneEvidence
) {
  const taskId = String(task?.workItemId ?? task?.taskId ?? '').trim();
  const normalizedTitle = String(task?.title ?? '').toLowerCase();
  if (taskId === 'TASK-TEAM-0002' || normalizedTitle.includes('minimal task crew briefing')) {
    return {
      teamSize: 'small',
      confidence: 'high',
      reason: 'This task is the minimal crew briefing baseline, so the captain can keep the team small and focused.'
    };
  }
  if (taskId === 'TASK-TEAM-0003' || normalizedTitle.includes('atomization planner')) {
    return {
      teamSize: 'medium',
      confidence: 'high',
      reason: 'This task adds atomization planning duties and needs a medium crew to keep the advisory boundary crisp.'
    };
  }
  if (taskId === 'TASK-TEAM-0007' || normalizedTitle.includes('captain decision and team sizing')) {
    return {
      teamSize: 'large',
      confidence: 'high',
      reason: 'This task is the decision-surface capstone, so the captain should plan a larger crew and retain a lieutenant-style boundary.'
    };
  }

  const scopeCount = uniqueStrings([
    ...normalizeStringArray(task?.scopePaths),
    ...normalizeStringArray(task?.deliverables),
    ...normalizeStringArray(task?.targetAllowedFiles)
  ]).length;
  const largeScriptRisk = evaluateLargeScriptRisk(writePaths);
  const highRiskSignals = [
    scopeCount > 3,
    largeScriptRisk.level === 'high',
    brokerLane.decision.verdict !== 'parallel-safe',
    validation.findings.some((finding) => finding.level === 'error')
  ].filter(Boolean).length;

  if (highRiskSignals >= 3) {
    return {
      teamSize: 'large',
      confidence: 'high',
      reason: 'Multiple high-risk signals indicate the captain should staff a larger crew and keep a lieutenant-style coordination boundary.'
    };
  }

  if (highRiskSignals >= 1) {
    return {
      teamSize: 'medium',
      confidence: 'medium',
      reason: 'The task has meaningful atomization or lane risk, so the captain should plan for a medium crew with broader validation support.'
    };
  }

  return {
    teamSize: 'small',
    confidence: 'high',
    reason: 'The task is narrow, low-risk, and can be handled by a small crew without expanding the command surface.'
  };
}

export function buildMinimalTaskCrewBriefingContract(
  task: Record<string, unknown> | null | undefined,
  writePaths: string[],
  validation: { ok: boolean; findings: PermissionFinding[] },
  brokerLane: TeamBrokerLaneEvidence
) {
  const requiredRoles: TeamCrewRole[] = [
    {
      role: 'Task Captain',
      agentId: 'coordinator',
      required: true,
      permissions: ['task.lifecycle', 'git.write', 'evidence.write'],
      description: 'Owns coordination, delivery closure, and final report routing.'
    },
    {
      role: 'Atomization Planner',
      agentId: 'atomization-planner',
      required: true,
      permissions: ['file.read'],
      description: 'Checks scope shape, atomization risk, and allowed-file boundaries.'
    },
    {
      role: 'Code Builder',
      agentId: 'implementer',
      required: true,
      permissions: ['file.write'],
      description: 'Implements the scoped task deliverables only inside allowed files.'
    },
    {
      role: 'Check Runner',
      agentId: 'validator',
      required: true,
      permissions: ['exec.validator'],
      description: 'Runs the required validators and reports pass or fail evidence.'
    }
  ];

  const optionalRoles: TeamCrewRole[] = [
    {
      role: 'Reader',
      agentId: 'reader',
      required: false,
      permissions: ['file.read'],
      description: 'Gathers source context when the task needs discovery.'
    },
    {
      role: 'Evidence Collector',
      agentId: 'evidence-collector',
      required: false,
      permissions: ['file.read'],
      description: 'Packages command-backed evidence for the report.'
    },
    {
      role: 'Scope Guardian',
      agentId: 'scope-guardian',
      required: false,
      permissions: ['file.read'],
      description: 'Watches for out-of-scope file drift.'
    }
  ];

  const cidConflicts = validation.findings.filter((f) => f.code === 'blocked-cid-conflict');
  const parallelAdvisory = cidConflicts.length > 0 ? {
    schemaId: 'atm.parallelAdvisory.v1',
    verdict: 'blocked-cid-conflict',
    reasons: cidConflicts.map((c) => c.detail),
    conflicts: cidConflicts
  } : null;
  const brokerAdvisory = brokerLane.chosenLane === 'neutral-steward' ? {
    schemaId: 'atm.teamBrokerAdvisory.v1',
    verdict: 'steward-lane',
    stewardId: brokerLane.stewardId,
    composerPath: brokerLane.composerPath,
    decision: brokerLane.decision
  } : brokerLane.safeToStart ? {
    schemaId: 'atm.teamBrokerAdvisory.v1',
    verdict: brokerLane.decision.verdict,
    chosenLane: brokerLane.chosenLane,
    decision: brokerLane.decision
  } : {
    schemaId: 'atm.teamBrokerAdvisory.v1',
    verdict: brokerLane.decision.verdict,
    chosenLane: brokerLane.chosenLane,
    blockedReasons: brokerLane.blockedReasons,
    decision: brokerLane.decision
  };

  return {
    schemaId: 'atm.teamCrewBriefingContract.v1',
    taskId: String(task?.workItemId ?? task?.taskId ?? 'unknown-task'),
    taskTitle: String(task?.title ?? task?.workItemId ?? task?.taskId ?? 'unknown-task'),
    allowedFiles: uniqueStrings(writePaths),
    doNotTouch: [
      '.atm/runtime/**',
      '.atm/history/**',
      'planning repository files',
      'unrelated source surfaces outside the task scope'
    ],
    expectedReports: [
      'team plan --task <id> --json',
      'validation result with safe-to-start or blocking findings',
      'team run record only if the coordinator chooses to start'
    ],
    stopConditions: [
      'scope must stay within declared allowed files',
      'required roles must each be uniquely represented',
      'validators must not report blocking permission conflicts',
      'a broader or stronger lane must stop the plan'
    ],
    requiredRoles,
    optionalRoles,
    validation,
    brokerAdvisory,
    ...(parallelAdvisory ? { parallelAdvisory } : {})
  };
}

export function buildAtomizationChecklist(task: Record<string, unknown> | null | undefined, writePaths: string[]) {
  const taskId = String(task?.workItemId ?? task?.taskId ?? 'unknown-task');
  const atomizationImpact = (task as { atomizationImpact?: Record<string, unknown> })?.atomizationImpact;
  const primaryAtom: string = String(atomizationImpact?.ownerAtomOrMap ?? atomizationImpact?.owner_atom_or_map ?? 'atm.team-agents-map');
  const taskAtomSet = getTaskScopedAtoms(taskId);
  const relatedAtoms = uniqueStrings([
    primaryAtom,
    ...taskAtomSet,
    ...normalizeStringArray(atomizationImpact?.mapUpdates ?? atomizationImpact?.map_updates).flatMap(normalizeAtomReference),
    ...inferRelatedAtoms(writePaths)
  ]);
  const commandSurface = uniqueStrings([
    ...normalizeStringArray((task as { scopePaths?: unknown })?.scopePaths),
    ...normalizeStringArray((task as { deliverables?: unknown })?.deliverables)
  ]);
  const largeScriptRisk = evaluateLargeScriptRisk(writePaths);
  const mapUpdateNeed = relatedAtoms.some((entry) => entry.includes('atom-map') || entry.includes('map'))
    || writePaths.some((entry) => entry.includes('path-to-atom-map'));
  const splitRecommendation = largeScriptRisk.level === 'high'
    ? 'Recommend split into focused atoms before deeper implementation.'
    : 'Keep advisory-only planning; no automatic split on this card.';

  return {
    primaryAtom,
    relatedAtoms,
    commandSurface,
    largeScriptRisk,
    mapUpdateNeed,
    splitRecommendation
  };
}

function getTaskScopedAtoms(taskId: string) {
  if (taskId === 'TASK-TEAM-0003') {
    return ['team.plan-atomization-planner', 'team.spec.atomization-planner'];
  }
  if (taskId === 'TASK-TEAM-0002') {
    return ['team.plan-crew-briefing-contract', 'team.spec.crew-briefing'];
  }
  if (taskId === 'TASK-TEAM-0009') {
    return [
      'team.plan-task-0009-preflight',
      'team.spec.command-surface',
      'team.plan-atomization-planner',
      'team.spec.atomization-planner',
      'team.plan-broker-lane',
      'team.spec.broker-lane'
    ];
  }
  return [];
}

function inferRelatedAtoms(writePaths: string[]) {
  return writePaths.map((entry) => {
    return normalizeAtomReference(entry)[0] ?? null;
  }).filter((entry) => Boolean(entry)) as string[];
}

function normalizeAtomReference(value: string) {
  const normalized = value.replace(/\\/g, '/');
  const basename = path.posix.basename(normalized);
  if (basename === 'team.ts') return ['atom-cli-team'];
  if (basename === 'next.ts') return ['atom-cli-next'];
  if (basename === 'evidence.ts') return ['atom-cli-evidence'];
  if (basename === 'hook.ts') return ['atom-cli-hook'];
  if (basename === 'path-to-atom-map.json') return ['atm.team-agents-map'];
  if (normalized.startsWith('atom-') || normalized.startsWith('atm.')) return [value];
  return [];
}

function evaluateLargeScriptRisk(writePaths: string[]) {
  const hotFiles = writePaths.filter((entry) => atomizationRiskHotFiles.has(path.posix.basename(entry.replace(/\\/g, '/'))));
  const level = hotFiles.length > 0 || writePaths.length > atomizationPlanningThreshold ? 'high' : 'low';
  return {
    level,
    threshold: atomizationPlanningThreshold,
    reasons: [
      ...(hotFiles.length > 0 ? [`hot file touched: ${hotFiles.join(', ')}`] : []),
      ...(writePaths.length > atomizationPlanningThreshold ? [`touched files ${writePaths.length} exceed planning threshold ${atomizationPlanningThreshold}`] : [])
    ]
  };
}

export function writeTeamRun(input: {
  cwd: string;
  actorId: string;
  taskId: string;
  task: Record<string, unknown> | null | undefined;
  recipe: TeamRecipe;
  teamPlan: ReturnType<typeof buildTeamPlan>;
  validation: { ok: boolean; findings: PermissionFinding[] };
  runtimeContract: TeamRuntimeContract;
}) {
  const now = new Date().toISOString();
  const teamRunId = createTeamRunId(input.taskId, input.actorId, now);
  const contributionComposition = composeTeamContributionManifests({
    taskId: input.taskId,
    baseCommit: input.teamPlan.shadowSchedule.baseCommit,
    contributions: [],
    declaredScope: deriveWritePaths(input.task, input.cwd)
  });
  const teamRun = {
    schemaId: 'atm.teamRun.v1',
    teamRunId,
    channel: input.teamPlan.channelHint,
    taskId: input.taskId,
    batchId: null,
    actorId: input.actorId,
    recipeId: input.recipe.recipeId,
    status: 'active',
    executionMode: 'manual-team',
    executionSurface: input.runtimeContract.executionSurface,
    runtimeMode: input.runtimeContract.runtimeMode,
    runtimeLanguage: input.runtimeContract.runtimeLanguage,
    runtimeAdapterId: input.runtimeContract.runtimeAdapterId,
    providerId: input.runtimeContract.providerId,
    sdkId: input.runtimeContract.sdkId,
    modelId: input.runtimeContract.modelId,
    runtimeContract: input.runtimeContract,
    artifactHandoff: input.runtimeContract.artifactHandoff,
    retryBudget: input.runtimeContract.retryBudget,
    brokerSubagent: input.runtimeContract.brokerSubagent,
    agentsSpawned: input.runtimeContract.agentsSpawned,
    runtimeWritten: true,
    task: summarizeTask(input.taskId, input.task),
    roles: input.recipe.agents.map((agent) => ({
      agentId: agent.agentId,
      role: agent.role,
      profile: agent.profile ?? null,
      language: agent.language ?? null,
      permissions: agent.permissions
    })),
    agents: input.recipe.agents,
    leases: input.teamPlan.suggestedPermissionLeases,
    permissionLeases: input.teamPlan.suggestedPermissionLeases,
    validation: input.validation,
    governanceRuntime: input.teamPlan.governanceRuntime,
    decisionClass: input.teamPlan.decisionClass,
    decisionReason: input.teamPlan.decisionReason,
    requiresHumanSignoff: input.teamPlan.requiresHumanSignoff,
    requiresAdr: input.teamPlan.requiresAdr,
    violationStatus: input.teamPlan.violationStatus,
    escalationTarget: input.teamPlan.escalationTarget,
    brokerLane: input.teamPlan.brokerLane,
    captainDecision: input.teamPlan.captainDecision,
    shadowSchedule: input.teamPlan.shadowSchedule,
    contributionComposition,
    runtimeTierContract: input.teamPlan.runtimeTierContract,
    runtimePilot: input.teamPlan.runtimePilot,
    reworkRoute: buildTeamReworkRouteStateMachine({
      findings: [],
      requiredChecksPassed: false,
      retryBudgetMax: input.runtimeContract.retryBudget.maxReworkCycles,
      retryBudgetUsed: 0
    }),
    agentReports: [],
    patrolFindings: [],
    evidenceCuratorSummary: null,
    teamSummary: {
      decision: input.teamPlan.captainDecision.reason,
      implementationSummary: `${input.runtimeContract.selectionReason}; closure remains governed by command-backed evidence.`,
      validators: normalizeStringArray((input.task as { validators?: unknown })?.validators),
      evidence: [],
      brokerGovernance: buildTeamBrokerGovernanceSummary(input.runtimeContract),
      risk: input.teamPlan.captainDecision.escalationRequired ? 'medium' : 'low',
      closeReady: false
    },
    createdAt: now,
    updatedAt: now
  };
  const directory = teamRunsDirectory(input.cwd);
  mkdirSync(directory, { recursive: true });
  writeJsonFile(path.join(directory, `${teamRunId}.json`), teamRun);
  return teamRun;
}

function buildTeamBrokerGovernanceSummary(runtimeContract: TeamRuntimeContract) {
  return {
    schemaId: 'atm.teamBrokerGovernanceSummary.v1',
    brokerSubagentEnabled: runtimeContract.brokerSubagent.enabled === true,
    brokerDecisionSurface: runtimeContract.brokerSubagent.decisionSurface,
    brokerStewardId: runtimeContract.brokerSubagent.stewardId,
    brokerGoverns: [...runtimeContract.brokerSubagent.governs],
    brokerEvidenceRequired: [...runtimeContract.brokerSubagent.evidenceRequired],
    commitLaneSerializedBy: runtimeContract.commitLane.serializedBy,
    commitLaneOwnerRole: runtimeContract.commitLane.ownerRole,
    workerGitWrite: runtimeContract.workerAdapter.authorityBoundary.gitWrite,
    workerTaskLifecycle: runtimeContract.workerAdapter.authorityBoundary.taskLifecycle,
    workerSelfClose: runtimeContract.workerAdapter.authorityBoundary.selfClose
  };
}

export function buildTeamStatusResult(input: {
  cwd: string;
  requestedTeamRunId: string;
  compact: boolean;
}) {
  const runs = input.requestedTeamRunId
    ? [readTeamRun(input.cwd, input.requestedTeamRunId)]
    : listTeamRuns(input.cwd).filter((run: unknown) => typeof run === 'object' && run !== null && (run as Record<string, unknown>).status === 'active');
  const sharedSurfaceQueues = readTeamSharedSurfaceQueues(input.cwd);
  const sharedSurfaceAcquisitionPlans = runs
    .map((run: any) => String(run?.taskId ?? '').trim())
    .filter(Boolean)
    .map((taskId) => planSharedSurfaceAcquisition(sharedSurfaceQueues, taskId));
  return makeResult({
    ok: true,
    command: 'team',
    cwd: input.cwd,
    messages: [
      message('info', 'ATM_TEAM_STATUS_READY', 'Team runtime status loaded.', {
        teamRunCount: runs.length,
        compact: input.compact
      })
    ],
    evidence: {
      action: 'status',
      teamRunCount: runs.length,
      teamRuns: input.compact ? runs.map(compactTeamRun) : runs,
      sharedSurfaceQueues,
      sharedSurfaceAcquisitionPlans
    }
  });
}

function readTeamSharedSurfaceQueues(cwd: string): SharedSurfaceQueue[] {
  const queuePath = path.join(cwd, '.atm', 'runtime', 'broker-shared-surface-queues.json');
  if (!existsSync(queuePath)) return [];
  try {
    const parsed = readJsonFile(queuePath, 'ATM_TEAM_SHARED_QUEUE_INVALID') as { queues?: unknown };
    return Array.isArray(parsed.queues) ? parsed.queues as SharedSurfaceQueue[] : [];
  } catch {
    return [];
  }
}

export function evaluateTeamRequiredCompletionGate(input: {
  cwd: string;
  taskId: string;
  taskDocument: Record<string, unknown>;
}) {
  const required = isTeamRequiredTask(input.taskDocument);
  if (!required) {
    return {
      ok: true,
      required: false,
      taskId: input.taskId,
      teamRun: null,
      requiredCommand: null
    };
  }
  const completedRun = listTeamRuns(input.cwd)
    .filter((run: unknown): run is Record<string, unknown> => typeof run === 'object' && run !== null)
    .filter((run) => run.taskId === input.taskId)
    .filter((run) => run.status === 'completed')
    .filter((run) => {
      const teamSummary = run.teamSummary;
      return typeof teamSummary === 'object' && teamSummary !== null && (teamSummary as Record<string, unknown>).closeReady === true;
    })
    .sort((left, right) => String(right.completedAt ?? right.updatedAt ?? '').localeCompare(String(left.completedAt ?? left.updatedAt ?? '')))[0] ?? null;
  const requiredCommand = `node atm.mjs team complete --team <teamRunId> --actor <coordinator> --reason "team.required close gate" --json`;
  return {
    ok: Boolean(completedRun),
    required: true,
    taskId: input.taskId,
    teamRun: completedRun ? compactTeamRun(completedRun) : null,
    requiredCommand
  };
}

function isTeamRequiredTask(taskDocument: Record<string, unknown>) {
  const direct = taskDocument.teamRequired ?? taskDocument['team.required'];
  if (direct === true || direct === 'true') return true;
  const team = taskDocument.team;
  if (typeof team === 'object' && team !== null) {
    const required = (team as Record<string, unknown>).required;
    return required === true || required === 'true';
  }
  return false;
}

export function buildTeamPatrolResult(input: {
  cwd: string;
  taskId: string;
  mode: TeamPatrolMode;
  requestedTeamRunId: string;
}) {
  const report = buildTeamPatrolReport(input);
  return makeResult({
    ok: true,
    command: 'team',
    cwd: input.cwd,
    messages: [
      message(report.safeToProceed ? 'info' : 'warning', report.safeToProceed ? 'ATM_TEAM_PATROL_READY' : 'ATM_TEAM_PATROL_FINDINGS', report.safeToProceed
        ? 'Team patrol completed with no blocking findings. No runtime or history state was written.'
        : 'Team patrol found follow-up items. No runtime or history state was written.', {
        taskId: input.taskId,
        mode: input.mode,
        severity: report.severity,
        findingCount: report.findings.length
      })
    ],
    evidence: report
  });
}

export function buildTeamPatrolReport(input: {
  cwd: string;
  taskId: string;
  mode: TeamPatrolMode;
  requestedTeamRunId: string;
}) {
  const findings: TeamPatrolFinding[] = [];
  const taskPath = path.join(input.cwd, '.atm', 'history', 'tasks', `${input.taskId}.json`);
  const evidencePath = path.join(input.cwd, '.atm', 'history', 'evidence', `${input.taskId}.json`);
  const closurePacketPath = path.join(input.cwd, '.atm', 'history', 'closure-packets', `${input.taskId}.json`);
  const taskExists = existsSync(taskPath);
  const evidenceExists = existsSync(evidencePath);
  const closurePacketExists = existsSync(closurePacketPath);
  const task = taskExists ? readJsonFile(taskPath, 'ATM_TEAM_TASK_INVALID') : null;
  const taskSummary = task ? summarizeTask(input.taskId, task) : { taskId: input.taskId, title: input.taskId, status: null, targetRepo: null, sourcePlanPath: null };
  const writePaths = task ? deriveWritePaths(task, input.cwd) : [];
  const largeScriptRisk = evaluateLargeScriptRisk(writePaths);
  const teamRun = input.requestedTeamRunId ? readTeamRun(input.cwd, input.requestedTeamRunId) : findLatestTeamRunForTask(input.cwd, input.taskId);

  if (!taskExists) {
    findings.push(teamPatrolFinding({
      level: 'blocker',
      code: 'ATM_TEAM_PATROL_TASK_MISSING',
      category: 'artifact-gap',
      summary: `Task ledger is missing for ${input.taskId}.`,
      suggestedCommand: `node atm.mjs next --task ${quoteCliValue(input.taskId)} --json`,
      details: { path: path.relative(input.cwd, taskPath).replace(/\\/g, '/') }
    }));
  }

  if (!evidenceExists) {
    findings.push(teamPatrolFinding({
      level: input.mode === 'close-preflight' ? 'blocker' : 'warning',
      code: 'ATM_TEAM_PATROL_EVIDENCE_MISSING',
      category: 'evidence',
      summary: `Command-backed evidence file is not present for ${input.taskId}.`,
      suggestedCommand: `node atm.mjs evidence run --task ${quoteCliValue(input.taskId)} --actor <actor> -- <validator-command>`,
      details: { path: path.relative(input.cwd, evidencePath).replace(/\\/g, '/') }
    }));
  }

  if (input.mode === 'close-preflight' && !closurePacketExists) {
    findings.push(teamPatrolFinding({
      level: 'warning',
      code: 'ATM_TEAM_PATROL_CLOSURE_PACKET_MISSING',
      category: 'artifact-gap',
      summary: `Closure packet has not been materialized for ${input.taskId}.`,
      suggestedCommand: `node atm.mjs taskflow pre-close --task ${quoteCliValue(input.taskId)} --actor <actor> --json`,
      details: { path: path.relative(input.cwd, closurePacketPath).replace(/\\/g, '/') }
    }));
  }

  if (!teamRun) {
    findings.push(teamPatrolFinding({
      level: 'info',
      code: 'ATM_TEAM_PATROL_NO_TEAM_RUN',
      category: 'runtime-mode',
      summary: 'No matching active team runtime record was found; patrol continues from ledger artifacts only.',
      suggestedCommand: `node atm.mjs team start --task ${quoteCliValue(input.taskId)} --actor <actor> --json`
    }));
  } else {
    const taskStatus = normalizeOptionalRuntimeString(taskSummary.status);
    if (taskStatus && ['done', 'abandoned', 'blocked'].includes(taskStatus) && String(teamRun.status ?? '').trim() === 'active') {
      findings.push(teamPatrolFinding({
        level: 'warning',
        code: 'ATM_TEAM_PATROL_STALE_TERMINAL_TEAM_RUN',
        category: 'runtime-mode',
        summary: `Team run ${teamRun.teamRunId} is still active even though task ${input.taskId} is already ${taskStatus}.`,
        suggestedCommand: `node atm.mjs tasks close --task ${quoteCliValue(input.taskId)} --actor <actor> --status ${taskStatus} --json`,
        details: { teamRunId: teamRun.teamRunId, taskStatus }
      }));
    }
    findings.push(...buildTeamRunPatrolFindings(teamRun, input));
  }

  if (input.mode === 'big-script' || largeScriptRisk.level === 'high') {
    findings.push(teamPatrolFinding({
      level: largeScriptRisk.level === 'high' ? 'warning' : 'info',
      code: largeScriptRisk.level === 'high' ? 'ATM_TEAM_PATROL_LARGE_SCRIPT_RISK' : 'ATM_TEAM_PATROL_SCOPE_LOW_RISK',
      category: 'scope',
      summary: largeScriptRisk.level === 'high'
        ? 'Task write scope has large-script or hot-file risk and should receive extra review.'
        : 'Task write scope does not exceed the large-script threshold.',
      suggestedCommand: largeScriptRisk.level === 'high'
        ? `node atm.mjs team plan --task ${quoteCliValue(input.taskId)} --json`
        : null,
      details: { writePaths, largeScriptRisk }
    }));
  }

  if (teamRun?.teamRunId) {
    findings.push(...buildTeamHandoffPatrolFindings(input.cwd, input.taskId, String(teamRun.teamRunId), input.mode));
  }

  const severity = summarizePatrolSeverity(findings);
  return {
    schemaId: 'atm.teamPatrolReport.v1',
    action: 'patrol',
    readOnly: true,
    runtimeWritten: false,
    historyWritten: false,
    agentsSpawned: false,
    mutations: [],
    taskId: input.taskId,
    runId: `patrol-${input.taskId}-${input.mode}`,
    patrolTeam: ['atomic-police', 'scope-guardian', 'evidence-auditor', 'runtime-sentinel'],
    mode: input.mode,
    severity,
    safeToProceed: severity !== 'blocker',
    findings,
    suggestedCommand: suggestedPatrolCommand(input.taskId, input.mode, severity),
    followUp: buildTeamPatrolFollowUp(input.taskId, input.mode, findings),
    task: taskSummary,
    inspected: {
      taskPath: path.relative(input.cwd, taskPath).replace(/\\/g, '/'),
      evidencePath: path.relative(input.cwd, evidencePath).replace(/\\/g, '/'),
      closurePacketPath: path.relative(input.cwd, closurePacketPath).replace(/\\/g, '/'),
      teamRunId: teamRun?.teamRunId ?? null,
      teamRunPath: teamRun?.teamRunId ? `.atm/runtime/team-runs/${teamRun.teamRunId}.json` : null,
      runtimeRoot: '.atm/runtime',
      historyRoot: '.atm/history'
    }
  };
}

function buildTeamHandoffPatrolFindings(cwd: string, taskId: string, teamRunId: string, mode: TeamPatrolMode): TeamPatrolFinding[] {
  const directory = teamHandoffRuntimeDirectory(cwd, taskId, teamRunId);
  if (!existsSync(directory)) return [];
  const findings: TeamPatrolFinding[] = [];
  const integrity = verifyTeamHandoffLedger(cwd, taskId, teamRunId);
  if (!integrity.ok) {
    findings.push(teamPatrolFinding({
      level: 'blocker', code: 'ATM_TEAM_PATROL_HANDOFF_INTEGRITY_BLOCKED', category: 'artifact-gap',
      summary: `Handoff ledger integrity is blocked: ${integrity.reason ?? 'unknown reason'}.`,
      suggestedCommand: `node atm.mjs team handoff show --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
      details: { teamRunId, reason: integrity.reason, canonicalReason: 'handoff-integrity-blocked' }
    }));
    return findings;
  }
  const indexPath = path.join(directory, 'index.md');
  const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : '';
  const expected = renderCanonicalTeamHandoffIndex(integrity.manifest, directory);
  if (!index || index !== expected) {
    findings.push(teamPatrolFinding({
      level: 'blocker', code: 'ATM_TEAM_PATROL_HANDOFF_NARRATIVE_DRIFT', category: 'artifact-gap',
      summary: 'Handoff Markdown is not the deterministic JSON-whitelist projection.',
      suggestedCommand: `node atm.mjs team handoff show --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
      details: { teamRunId, canonicalReason: 'handoff-integrity-blocked' }
    }));
  }
  if (/\uFFFD/.test(index) || Buffer.from(index, 'utf8').toString('utf8') !== index) {
    findings.push(teamPatrolFinding({
      level: 'blocker', code: 'ATM_TEAM_PATROL_HANDOFF_ENCODING_INVALID', category: 'artifact-gap',
      summary: 'Handoff Markdown is not valid stable UTF-8 text.',
      suggestedCommand: `node atm.mjs team handoff show --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
      details: { teamRunId, canonicalReason: 'handoff-integrity-blocked' }
    }));
  }
  const bytes = integrity.manifest.artifacts.reduce((total, entry) => total + readFileSync(path.join(directory, entry.file)).byteLength, 0);
  if (integrity.manifest.transitionCount >= 64 || bytes >= 512 * 1024) {
    findings.push(teamPatrolFinding({
      level: 'blocker', code: 'ATM_TEAM_PATROL_HANDOFF_HARD_LIMIT', category: 'runtime-mode',
      summary: 'Handoff retention hard limit requires Captain sign-off before another transition.',
      suggestedCommand: `node atm.mjs team handoff stats --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
      details: { teamRunId, transitionCount: integrity.manifest.transitionCount, bytes, decisionClass: 'human-signoff-required' }
    }));
  } else if (integrity.manifest.transitionCount >= 48 || bytes >= 384 * 1024) {
    findings.push(teamPatrolFinding({
      level: mode === 'close-preflight' ? 'warning' : 'info', code: 'ATM_TEAM_PATROL_HANDOFF_SOFT_LIMIT', category: 'runtime-mode',
      summary: 'Handoff retention soft limit reached; Captain should prepare to split or archive the run.',
      suggestedCommand: `node atm.mjs team handoff stats --task ${quoteCliValue(taskId)} --team ${quoteCliValue(teamRunId)} --json`,
      details: { teamRunId, transitionCount: integrity.manifest.transitionCount, bytes }
    }));
  }
  return findings;
}

function renderCanonicalTeamHandoffIndex(manifest: Parameters<typeof renderTeamHandoffIndex>[0], directory: string) {
  return renderTeamHandoffIndex(manifest, readTeamHandoffArtifacts(directory, manifest));
}

function normalizeTeamLifecyclePaths(value: unknown): string[] {
  return uniqueStrings(String(value ?? '')
    .split(',')
    .map((entry) => entry.trim().replace(/\\/g, '/'))
    .filter(Boolean));
}

function runTeamLifecycleAction(input: {
  cwd: string;
  action: TeamLifecycleAction;
  teamRunId: string;
  actorId: string;
  permission: string;
  paths: string[];
  reason: string;
}) {
  if (!input.teamRunId) {
    throw new CliError('ATM_TEAM_RUN_REQUIRED', `team ${input.action} requires --team <id>.`, { exitCode: 2 });
  }
  if (!input.actorId) {
    throw new CliError('ATM_TEAM_ACTOR_REQUIRED', `team ${input.action} requires --actor <id>.`, { exitCode: 2 });
  }
  if ((input.action === 'lease' || input.action === 'release') && !input.permission) {
    throw new CliError('ATM_TEAM_PERMISSION_REQUIRED', `team ${input.action} requires --permission <id>.`, { exitCode: 2 });
  }

  if (input.action === 'lease' || input.action === 'release') {
    const definition = teamPermissionCatalog.find((entry) => entry.id === input.permission);
    if (!definition || definition.hardGate !== true) {
      throw new CliError('ATM_TEAM_PERMISSION_HARD_GATE_BLOCKED', `Permission ${input.permission || '<missing>'} is not registered with a hard gate.`, {
        exitCode: 1,
        details: {
          teamRunId: input.teamRunId,
          permission: input.permission || null,
          gateId: 'ATM_TEAM_PERMISSION_HARD_GATE',
          requiredCommand: 'node atm.mjs team validate --json'
        }
      });
    }
    if (input.action === 'lease' && definition.scopeRequired && input.paths.length === 0) {
      throw new CliError('ATM_TEAM_PERMISSION_SCOPE_REQUIRED', `Permission ${input.permission} requires explicit scoped paths.`, {
        exitCode: 1,
        details: {
          teamRunId: input.teamRunId,
          permission: input.permission,
          gateId: 'ATM_TEAM_PERMISSION_HARD_GATE',
          requiredCommand: `node atm.mjs team lease --team ${input.teamRunId} --actor ${input.actorId} --permission ${input.permission} --paths <scoped-paths> --json`
        }
      });
    }
  }

  const run = readTeamRun(input.cwd, input.teamRunId) as Record<string, unknown>;
  const status = String(run.status ?? '');
  if (status !== 'active') {
    throw new CliError('ATM_TEAM_RUN_NOT_ACTIVE', `Team run ${input.teamRunId} is ${status || 'unknown'}, not active.`, {
      exitCode: 1,
      details: { teamRunId: input.teamRunId, status }
    });
  }

  const now = new Date().toISOString();
  const currentLeases = normalizePermissionLeaseRecords(run.permissionLeases ?? run.leases);
  const lifecycleEvents = Array.isArray(run.lifecycleEvents) ? [...run.lifecycleEvents] : [];
  let nextLeases = currentLeases;

  if (input.action === 'lease') {
    const conflict = currentLeases.find((lease) => lease.permission === input.permission && lease.agentId !== input.actorId);
    if (conflict) {
      throw new CliError('ATM_TEAM_LEASE_CONFLICT', `Permission ${input.permission} is already leased to ${conflict.agentId}.`, {
        exitCode: 1,
        details: buildTeamLeaseConflictDetails({
          teamRunId: input.teamRunId,
          permission: input.permission,
          requestedOwner: input.actorId,
          conflict,
          currentLeases
        })
      });
    }
    const lease = {
      permission: input.permission,
      agentId: input.actorId,
      paths: input.paths
    };
    nextLeases = [
      ...currentLeases.filter((entry) => !(entry.permission === input.permission && entry.agentId === input.actorId)),
      lease
    ];
    lifecycleEvents.push(teamLifecycleEvent('lease.granted', input, now, { lease }));
  }

  if (input.action === 'release') {
    const matched = currentLeases.filter((lease) => lease.permission === input.permission && lease.agentId === input.actorId);
    if (matched.length === 0) {
      throw new CliError('ATM_TEAM_LEASE_NOT_FOUND', `No ${input.permission} lease owned by ${input.actorId} exists on ${input.teamRunId}.`, {
        exitCode: 1,
        details: buildTeamLeaseNotFoundDetails({
          teamRunId: input.teamRunId,
          permission: input.permission,
          actorId: input.actorId,
          currentLeases
        })
      });
    }
    nextLeases = currentLeases.filter((lease) => !(lease.permission === input.permission && lease.agentId === input.actorId));
    lifecycleEvents.push(teamLifecycleEvent('lease.released', input, now, { releasedLeases: matched }));
  }

  if (input.action === 'complete') {
    run.status = 'completed';
    run.completedAt = now;
    run.completedBy = input.actorId;
    run.completionReason = input.reason || null;
    const teamSummary = typeof run.teamSummary === 'object' && run.teamSummary !== null
      ? { ...(run.teamSummary as Record<string, unknown>), closeReady: true }
      : { closeReady: true };
    run.teamSummary = teamSummary;
    lifecycleEvents.push(teamLifecycleEvent('team.completed', input, now));
  }

  if (input.action === 'abandon') {
    run.status = 'abandoned';
    run.abandonedAt = now;
    run.abandonedBy = input.actorId;
    run.abandonReason = input.reason || null;
    const teamSummary = typeof run.teamSummary === 'object' && run.teamSummary !== null
      ? { ...(run.teamSummary as Record<string, unknown>), closeReady: false }
      : { closeReady: false };
    run.teamSummary = teamSummary;
    lifecycleEvents.push(teamLifecycleEvent('team.abandoned', input, now));
  }

  run.leases = nextLeases;
  run.permissionLeases = nextLeases;
  run.lifecycleEvents = lifecycleEvents;
  run.updatedAt = now;
  writeExistingTeamRun(input.cwd, input.teamRunId, run);

  return makeResult({
    ok: true,
    command: 'team',
    cwd: input.cwd,
    messages: [
      message('info', 'ATM_TEAM_LIFECYCLE_UPDATED', `Team run ${input.teamRunId} ${input.action} recorded.`, {
        teamRunId: input.teamRunId,
        action: input.action,
        status: run.status,
        leaseCount: nextLeases.length
      })
    ],
    evidence: {
      action: `team.${input.action}`,
      teamRunId: input.teamRunId,
      actorId: input.actorId,
      permission: input.permission || null,
      paths: input.paths,
      status: run.status,
      leaseCount: nextLeases.length,
      lifecycleEventCount: lifecycleEvents.length,
      teamRun: compactTeamRun(run)
    }
  });
}

function teamLifecycleEvent(type: string, input: {
  action: TeamLifecycleAction;
  teamRunId: string;
  actorId: string;
  permission: string;
  paths: string[];
  reason: string;
}, occurredAt: string, extra: Record<string, unknown> = {}) {
  return {
    schemaId: 'atm.teamRuntimeLifecycleEvent.v1',
    type,
    teamRunId: input.teamRunId,
    actorId: input.actorId,
    permission: input.permission || null,
    paths: input.paths,
    reason: input.reason || null,
    occurredAt,
    ...extra
  };
}

function normalizeTeamPatrolMode(value: unknown): TeamPatrolMode {
  const mode = String(value ?? 'claim-preflight').trim();
  if (['claim-preflight', 'close-preflight', 'big-script', 'daily-noon'].includes(mode)) {
    return mode as TeamPatrolMode;
  }
  throw new CliError('ATM_TEAM_PATROL_MODE_INVALID', `Unsupported team patrol mode: ${mode}`, {
    exitCode: 2,
    details: { supportedModes: ['claim-preflight', 'close-preflight', 'big-script', 'daily-noon'] }
  });
}

function summarizeTask(taskId: string, task: Record<string, unknown> | null | undefined) {
  return {
    taskId,
    title: (task as { title?: unknown })?.title ?? (task as { workItemId?: unknown })?.workItemId ?? taskId,
    status: (task as { status?: unknown })?.status ?? null,
    targetRepo: (task as { targetRepo?: unknown })?.targetRepo ?? null,
    sourcePlanPath: (task as { source?: { planPath?: unknown } })?.source?.planPath ?? (task as { sourcePlanPath?: unknown })?.sourcePlanPath ?? null
  };
}

function classifyTeamPilotFinding(code: string | null | undefined) {
  const normalized = String(code ?? '').toLowerCase();
  if (normalized.includes('scope')) return 'boundary-confusion';
  if (normalized.includes('lease') || normalized.includes('broker')) return 'role-specific-friction';
  if (normalized.includes('validator')) return 'validator-gap';
  return 'tooling-mismatch';
}

function normalizeTeamBrokerPilotFindings(
  brokerLane: TeamBrokerLaneEvidence,
  promotionTarget: string
): Array<{
  category: string;
  summary: string;
  detail: string;
  correctRoute: string;
  promotionTarget: string;
}> {
  const decision = brokerLane?.decision;
  if (!decision) {
    return [];
  }
  const conflicts = Array.isArray(decision.conflicts) ? decision.conflicts : [];
  if (conflicts.length === 0) {
    return [{
      category: 'role-specific-friction',
      summary: decision.reason ?? 'Broker-governed pilot requires refinement.',
      detail: decision.reason ?? 'No broker detail was provided.',
      correctRoute: 'Surface the broker verdict as pilot evidence and keep Coordinator from forcing a start.',
      promotionTarget
    }];
  }
  return conflicts.map((conflict) => ({
    category: conflict.kind === 'lease' ? 'role-specific-friction' : 'boundary-confusion',
    summary: decision.reason ?? 'Broker-governed pilot finding',
    detail: String(conflict.detail ?? '').trim() || 'Broker conflict detail unavailable.',
    correctRoute: 'Use takeover, repair, or bounded proposal flow before attempting a worker write lease again.',
    promotionTarget
  }));
}

function deriveWritePaths(task: Record<string, unknown> | null | undefined, repoRoot?: string) {
  return deriveTeamWriteScope(task, repoRoot).writePaths;
}

function deriveTeamWriteScope(task: Record<string, unknown> | null | undefined, repoRoot?: string) {
  const explicitAllowed = normalizeTaskPathArray((task as { targetAllowedFiles?: unknown })?.targetAllowedFiles, repoRoot);
  if (explicitAllowed.length > 0) {
    return {
      writePaths: normalizeTaskWriteScope(explicitAllowed, repoRoot),
      planningReadOnlyPaths: [] as string[],
      allowEmptyWriteScope: false
    };
  }

  const rawCandidates = [
    ...normalizeStringArray((task as { deliverables?: unknown })?.deliverables),
    ...normalizeStringArray((task as { scopePaths?: unknown })?.scopePaths)
  ];
  const candidates = normalizeTargetWritePathArray(rawCandidates, repoRoot);
  const planningReadOnlyPaths = collectPlanningReadOnlyPaths(task, repoRoot, rawCandidates);
  const writePaths = uniqueStrings(candidates.map((entry) => normalizeTeamLeasePath(entry, repoRoot)).filter((normalized) => {
    return normalized && !normalized.startsWith('.atm/runtime/') && !normalized.startsWith('.atm/history/');
  }));
  return {
    writePaths,
    planningReadOnlyPaths,
    allowEmptyWriteScope: writePaths.length === 0 && planningReadOnlyPaths.length > 0
  };
}

function collectPlanningReadOnlyPaths(task: Record<string, unknown> | null | undefined, repoRoot: string | undefined, rawCandidates: string[]) {
  const planningRepo = String((task as { planningRepo?: unknown } | null | undefined)?.planningRepo ?? '').trim();
  if (!planningRepo) return [];
  const planningRoot = path.isAbsolute(planningRepo)
    ? path.resolve(planningRepo)
    : (repoRoot ? path.resolve(repoRoot, planningRepo) : '');
  if (!planningRoot) return [];
  return uniqueStrings(rawCandidates.map((entry) => normalizeAbsolutePathUnderRoot(entry, planningRoot)).filter(Boolean));
}

function normalizeAbsolutePathUnderRoot(rawPath: string, rootPath: string) {
  const raw = String(rawPath).trim();
  if (!raw || !path.isAbsolute(raw)) return '';
  const candidate = path.resolve(raw);
  const relative = path.relative(path.resolve(rootPath), candidate);
  if (!relative || relative === '') return '';
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return '';
  return relative.replace(/\\/g, '/');
}

function normalizeTargetWritePathArray(paths: string[], repoRoot?: string) {
  return paths
    .map((entry) => normalizeTargetWritePath(entry, repoRoot))
    .filter((entry) => Boolean(entry) && validateStrictPathHeuristic(entry) === null);
}

function normalizeTargetWritePath(rawPath: string, repoRoot?: string) {
  const raw = String(rawPath).trim();
  if (!raw) return '';
  const normalizedRaw = raw.replace(/\\/g, '/');
  if ((normalizedRaw.startsWith('/') || /^[A-Za-z]:\//.test(normalizedRaw)) && normalizeRepoAbsoluteLeasePath(raw, repoRoot) === null) {
    return '';
  }
  return normalizeTeamLeasePath(raw, repoRoot);
}

function collectTaskPathHints(task: Record<string, unknown> | null | undefined) {
  return uniqueStrings([
    ...normalizeTaskPathArray((task as { targetAllowedFiles?: unknown })?.targetAllowedFiles),
    ...normalizeTaskPathArray((task as { deliverables?: unknown })?.deliverables),
    ...normalizeTaskPathArray((task as { scopePaths?: unknown })?.scopePaths)
  ]);
}

function normalizeTaskPathArray(value: unknown, repoRoot?: string) {
  return normalizeStringArray(value)
    .map((entry) => normalizeTeamLeasePath(entry, repoRoot))
    .filter((entry) => Boolean(entry) && validateStrictPathHeuristic(entry) === null);
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((entry) => String(entry).trim()).filter(Boolean) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

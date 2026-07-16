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
import type { TeamBrokerLaneEvidence } from '../../../core/src/broker/team-lane.ts';
import { runTeamWave } from './team-wave.ts';
import type { TeamWorkerAdapterContract } from '../../../core/src/team-runtime/nodejs-worker-adapter.ts';
import {
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
import { inspectGitIndexOwnership } from './git-index-ownership.ts';
import { loadTeamProviderSelectionConfigFromRepo } from './team/role-provider-resolution.ts';
import { composeTeamContributionManifests } from './team/composer.ts';
import { resolveTeamStartExecutionLane } from './team/team-execution-lane.ts';
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
  buildBrokerConflictSharedVocabulary,
  buildBrokerConflictUxProjection,
  evaluateTeamRuntimeBackendAdmission,
  runTeamBroker,
  runTeamBrokerConflictResolve,
  runTeamObservability
} from './team/legacy/broker-observability.ts';
export {
  buildBrokerConflictSharedVocabulary,
  buildBrokerConflictUxProjection,
  runTeamBrokerConflictResolve
};
import {
  buildCliGlobalProviderDefault,
  buildReviewAgentSignature,
  buildTeamClosureAttestation,
  buildTeamRuntimeContract,
  evaluateReviewerIndependence,
  evaluateReviewQuorum,
  normalizeOptionalRuntimeString,
  normalizeTeamRuntimeMode
} from './team/legacy/runtime-governance.ts';
export {
  buildReviewAgentSignature,
  buildTeamClosureAttestation,
  buildTeamRuntimeContract,
  evaluateReviewerIndependence,
  evaluateReviewQuorum
};
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
  buildTeamPlan,
  buildTeamRuntimePilot,
  planTeamBrokerLane,
  readActiveTaskClaimActorId,
  resolveTeamPlanActorId
} from './team/legacy/plan-orchestration.ts';
export {
  buildTeamPlan,
  buildTeamRuntimePilot,
  planTeamBrokerLane,
  readActiveTaskClaimActorId,
  resolveTeamPlanActorId
};
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
import {
  buildAtomizationChecklist,
  buildCaptainDecision,
  evaluateLargeScriptRisk,
  buildMinimalTaskCrewBriefingContract,
  normalizeTeamSizeOverride,
  assessLieutenantEscalation
} from './team/legacy/crew-decision-policy.ts';
import {
  mapTeamSizeToLevel,
  projectTeamRecipeForLevel,
  selectTeamImplementer
} from './team/legacy/implementer-selector-policy.ts';
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
export {
  buildAtomizationChecklist,
  buildCaptainDecision,
  evaluateLargeScriptRisk,
  buildMinimalTaskCrewBriefingContract,
  normalizeTeamSizeOverride,
  assessLieutenantEscalation
} from './team/legacy/crew-decision-policy.ts';
export {
  mapTeamSizeToLevel,
  projectTeamRecipeForLevel,
  selectTeamImplementer
} from './team/legacy/implementer-selector-policy.ts';

import {
  TEAM_ATOM_BOUNDARIES,
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
  type TeamEditorSubagentBridgeContract,
  type TeamEditorSubagentRoleEnvelope,
  type TeamGovernanceRuntimeFields,
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

export { runTeam } from './team/legacy/command-runner.ts';
export { writeTeamRun, buildTeamStatusResult, evaluateTeamRequiredCompletionGate } from './team/legacy/team-run-runtime.ts';
export { buildTeamPatrolResult, buildTeamPatrolReport } from './team/legacy/patrol-handler.ts';
export { buildTeamPlanningContext } from './team/legacy/planning-context.ts';
export { deriveWritePaths } from './team/legacy/team-utils.ts';

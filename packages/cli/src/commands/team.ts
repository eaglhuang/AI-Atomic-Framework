import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
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
import { runTasks } from './tasks.ts';
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
  queryTeamObservabilityEvents
} from '../../../core/src/team-runtime/observability.ts';
import { buildAzureOpenAITeamProviderBridgeDescriptor } from '../../../core/src/team-runtime/providers/azure-openai.ts';
import { buildOpenAITeamProviderBridgeDescriptor } from '../../../core/src/team-runtime/providers/openai.ts';
import { TEAM_PROVIDER_IDS } from '../../../core/src/team-runtime/provider-contract.ts';
import { resolveTeamProviderSelection, type TeamProviderSelectionConfig } from '../../../core/src/team-runtime/provider-selection.ts';

type TeamPermissionMode = 'exclusive' | 'shareable';

type TeamPermissionDefinition = {
  id: string;
  mode: TeamPermissionMode;
  scopeRequired?: boolean;
};

type TeamRecipeAgent = {
  agentId: string;
  role: string;
  profile?: string;
  language?: string;
  permissions: string[];
};

type TeamRecipe = {
  schemaId: 'atm.teamRecipe.v1';
  recipeId: string;
  appliesTo?: string[];
  language?: string;
  agents: TeamRecipeAgent[];
};

type PermissionFinding = {
  level: 'error' | 'warning';
  code: string;
  summary: string;
  detail: string;
  role?: string;
  permission?: string;
  agentIds?: string[];
  paths?: string[];
  suggestedFix: string;
};

type PermissionLease = {
  permission: string;
  agentId: string;
  paths?: string[];
};

type TeamPermissionValidationOptions = {
  allowedWritePaths?: string[];
  repoRoot?: string;
  allowEmptyWriteScope?: boolean;
};

type TeamCrewRole = {
  role: string;
  agentId: string;
  required: boolean;
  permissions: string[];
  description: string;
};

type TeamRoleSkillPackContract = {
  schemaId: 'atm.teamRoleSkillPackContract.v1';
  providerNeutral: true;
  coordinatorOwnsLifecycle: true;
  roles: Array<{
    role: string;
    agentId: string;
    skillPackId: string;
    specialistSkills: string[];
    allowedPermissions: string[];
    forbiddenPermissions: string[];
    playbookSlice: string;
    growthContractAttachment: string;
  }>;
};

type TeamRoleSkillPackManifest = {
  schemaId: 'atm.teamRoleSkillPackManifest.v1';
  providerNeutral: true;
  coordinatorOwnsLifecycle: true;
  discoveryMode: 'capability-driven';
  roleFirstProviderSecond: true;
  sharedVocabulary: {
    brokerConflict: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'];
  };
  roles: Array<{
    role: string;
    skillPackId: string;
    playbookSlice: string;
    capabilityTags: string[];
    permissionLease: {
      alignment: 'role-first';
      allowedPermissions: string[];
      forbiddenPermissions: string[];
    };
    selectedProvider: {
      providerId: string;
      sdkId: string;
      modelId: string;
      runtimeMode: TeamRuntimeMode;
      source: 'repo-default' | 'role-override';
    };
    providerCapabilities: Array<{
      providerId: string;
      runtimeModes: TeamRuntimeMode[];
      artifacts: string[];
      satisfiesRolePack: true;
      reason: string;
    }>;
    growthContractAttachment: string;
  }>;
};

type TeamRoleRoutingMatrix = {
  schemaId: 'atm.teamRoleRoutingMatrix.v1';
  providerNeutral: true;
  coordinatorOwnsLifecycle: true;
  routes: Array<{
    workstream: string;
    primaryRole: string;
    supportingRoles: string[];
    advisoryRoles: string[];
    roleOrder: string[];
    parallelSafeRoles: string[];
    advisoryOnlyRoles: string[];
    playbookSlice: string;
    lifecycleOwner: 'coordinator';
    stopConditions: string[];
  }>;
};

type TeamGrowthContract = {
  schemaId: 'atm.teamGrowthContract.v1';
  sharedAcrossRolePacks: true;
  taxonomy: string[];
  captureTemplate: string[];
  promotionPolicy: {
    stableRuleTarget: string;
    rawCaseTarget: string;
  };
};

type TeamRoleGrowthObservabilityContract = {
  schemaId: 'atm.teamRoleGrowthObservabilityContract.v1';
  sharedAcrossRolePacks: true;
  referenceFirst: true;
  sourceGrowthContract: 'atm.teamGrowthContract.v1';
  sourceObservabilityContract: 'atm.teamAgentObservabilityContract.v1';
  learningEventProjection: {
    eventSchemaId: 'atm.teamAgentObservabilityEvent.v1';
    eventType: 'artifact.output';
    artifactType: 'atm.teamRoleGrowthLearningItem.v1';
    queryKeys: string[];
    artifactFields: string[];
  };
  frictionClassification: {
    sharedAtmRoutingFriction: string[];
    roleSpecificFriction: string[];
  };
  roleMappings: Array<{
    role: string;
    agentId: string;
    skillPackId: string;
    playbookSlice: string;
    growthAttachmentPoint: string;
    learningReference: string;
    taxonomy: string[];
    observableEventSelector: {
      role: string;
      eventType: 'artifact.output';
      artifactType: 'atm.teamRoleGrowthLearningItem.v1';
    };
  }>;
  metrics: Array<{
    metricId: string;
    description: string;
    numerator: Record<string, string>;
    denominator: Record<string, string>;
    groupedBy: string[];
  }>;
  brokerConflictVocabulary: {
    decisionClass: string;
    decisionReason: string;
    violationStatus: string;
    blockedCode: 'broker-conflict-blocked';
  };
};

type TeamOpenAIFamilyRuntimeBridgeSummary = {
  schemaId: 'atm.openAIFamilyRuntimeBridgeSummary.v1';
  milestone: 'M9I';
  providerIds: readonly ['openai', 'azure-openai'];
  sharedProviderInterface: 'atm.teamProviderContract.v1';
  sharedArtifactType: 'atm.teamProviderRunArtifact.v1';
  observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1';
  coordinatorOwnedAuthority: true;
  brokerConflictVocabulary: readonly ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'];
  bridges: readonly [
    ReturnType<typeof buildOpenAITeamProviderBridgeDescriptor>,
    ReturnType<typeof buildAzureOpenAITeamProviderBridgeDescriptor>
  ];
};

type TeamRuntimePilot = {
  schemaId: 'atm.teamRuntimePilot.v1';
  providerNeutral: true;
  coordinatorOwnsLifecycle: true;
  pilotMode: 'role-pair' | 'role-trio';
  selectedRoles: string[];
  selectedSkillPackIds: string[];
  agentSkillUnits: Array<{
    role: string;
    agentId: string;
    skillPackId: string;
    boundedSkillPackLoaded: true;
    permissionLease: {
      allowedPermissions: string[];
      forbiddenPermissions: string[];
    };
    playbookSlice: string;
    lifecycleAuthority: 'coordinator-owned' | 'worker-forbidden';
  }>;
  realisticWorkflow: string[];
  workflowEvidence: {
    scenarioId: 'agent-plus-skill-runtime-pilot';
    roleOrder: string[];
    coordinatorOnlyLifecyclePreserved: true;
    workerWriteScope: 'bounded-by-task-lease';
    blockedByBroker: boolean;
    brokerViolationStatus: 'none' | 'proposal-submitted' | 'broker-conflict-blocked';
  };
  roleBoundarySignals: string[];
  lifecycleAuthority: {
    ownerRole: string;
    forbiddenToWorkers: string[];
  };
  roleConfusionReduction: string[];
  roleConfusionMetrics: {
    baselineLoadedSkillPacks: 'monolithic-team-context';
    pilotLoadedSkillPacks: string[];
    preventedPermissionDrift: string[];
    refinementSignalCount: number;
  };
  roleGrowthObservability: {
    contractSchemaId: 'atm.teamRoleGrowthObservabilityContract.v1';
    eventType: 'artifact.output';
    artifactType: 'atm.teamRoleGrowthLearningItem.v1';
    frictionDimensions: ['shared-atm-routing-friction', 'role-specific-friction'];
    brokerConflictBlockedMetricId: 'broker-conflict-blocked.hit-rate';
    roleContractMappings: Array<{
      role: string;
      skillPackId: string;
      playbookSlice: string;
    }>;
  };
  brokerConflictVocabulary: {
    decisionClass: string;
    decisionReason: string;
    violationStatus: 'allowed' | 'proposal-submitted' | 'broker-conflict-blocked';
    blockedCode: 'broker-conflict-blocked' | null;
  };
  actionableRefinementFindings: Array<{
    category: string;
    summary: string;
    detail: string;
    correctRoute: string;
    promotionTarget: string;
  }>;
};

type TeamImplementerSelector = {
  schemaId: 'atm.teamImplementerSelector.v1';
  selectedImplementer: {
    agentId: string;
    role: string;
    profile?: string;
    language?: string;
    recipeId: string;
  };
  languageMatch: 'typescript' | 'python' | 'unknown';
  roleMatch: 'typescript-implementer' | 'python-implementer' | 'ui-implementer' | 'generic-implementer';
  fallbackReason: string;
  confidence: 'low' | 'medium' | 'high';
  deterministicHints: {
    scopePaths: string[];
    deliverables: string[];
    fileExtensions: string[];
    pathHints: string[];
    pythonHeavy: boolean;
    typescriptHeavy: boolean;
    uiPaths: boolean;
  };
};

type TeamPatrolMode = 'claim-preflight' | 'close-preflight' | 'big-script' | 'daily-noon';

type TeamPatrolFindingLevel = 'info' | 'warning' | 'blocker';

type TeamRuntimeMode = 'real-agent' | 'editor-subagent' | 'broker-only';

type TeamReworkRouteStatus =
  | 'work-in-progress'
  | 'needs-rework'
  | 'revalidate-pending'
  | 'ready-for-close'
  | 'blocked'
  | 'escalated';

type TeamReworkFinding = {
  source: 'reviewer' | 'validator';
  id: string;
  blocking?: boolean;
  passed?: boolean;
  severity?: 'info' | 'warning' | 'error' | 'blocker';
  summary?: string;
};

type TeamReworkTransition = {
  from: TeamReworkRouteStatus;
  to: TeamReworkRouteStatus;
  reason: string;
  findingIds: string[];
};

type TeamReworkRoute = {
  schemaId: 'atm.teamReworkRoute.v1';
  status: TeamReworkRouteStatus;
  retryBudget: {
    maxAttempts: number;
    used: number;
    remaining: number;
    escalationTarget: string | null;
  };
  requiredChecksPassed: boolean;
  findings: TeamReworkFinding[];
  transitions: TeamReworkTransition[];
};

type TeamRoleArtifactContract = {
  schemaId: 'atm.teamRoleArtifactContract.v1';
  agentId: string;
  role: string;
  consumesFrom: string[];
  producesTo: string[];
  requiredArtifacts: string[];
};

type TeamArtifactHandoffFinding = {
  level: 'info' | 'warning' | 'error';
  code: string;
  role: string;
  agentId: string;
  artifact: string | null;
  blocking: boolean;
  summary: string;
};

type TeamArtifactHandoffContract = {
  schemaId: 'atm.teamArtifactHandoffContract.v1';
  requiredRoles: string[];
  roleContracts: TeamRoleArtifactContract[];
  findings: TeamArtifactHandoffFinding[];
  closeAllowed: boolean;
};

type TeamRetryBudgetContract = {
  schemaId: 'atm.teamRetryBudgetContract.v1';
  maxReworkCycles: number;
  maxValidatorReruns: number;
  maxReviewerReturns: number;
  usedReworkCycles: number;
  usedValidatorReruns: number;
  usedReviewerReturns: number;
  exhausted: boolean;
  escalationTarget: string | null;
  status: 'within-budget' | 'escalation-required';
};

type TeamCommitLaneContract = {
  schemaId: 'atm.teamCommitLaneContract.v1';
  ownerRole: 'coordinator';
  ownerPermissions: readonly ['task.lifecycle', 'git.write', 'evidence.write'];
  workerGitWrite: false;
  serializedBy: 'branch-commit-queue';
  lockSchemaId: 'atm.branchCommitQueueLock.v1';
  retryableCodes: readonly ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE'];
};

type TeamBrokerSubagentContract = {
  schemaId: 'atm.teamBrokerSubagentContract.v1';
  enabled: true;
  subagentId: 'team-broker-subagent';
  lifecycleOwner: 'atm';
  decisionSurface: 'brokerLane';
  governs: readonly ['write-intents', 'scope-conflicts', 'steward-apply', 'commit-lane'];
  stewardId: 'neutral-write-steward';
  evidenceRequired: readonly ['atm.teamBrokerLaneEvidence.v1', 'atm.stewardApplyEvidence.v1', 'atm.brokerOperationRunRecordEnvelope.v1'];
  authorityBoundary: {
    fileWrite: false;
    gitWrite: false;
    taskLifecycle: false;
    selfClose: false;
  };
  escalationTarget: 'coordinator';
};

type TeamRuntimeContract = {
  schemaId: 'atm.teamRuntimeContract.v1';
  runtimeMode: TeamRuntimeMode;
  runtimeLanguage: string;
  runtimeAdapterId: string | null;
  providerId: string | null;
  sdkId: string | null;
  modelId: string | null;
  agentsSpawned: boolean;
  executionSurface: 'agent-runtime' | 'editor-subagent' | 'broker-governance';
  selectionReason: string;
  workerAdapter: TeamWorkerAdapterContract;
  artifactHandoff: TeamArtifactHandoffContract;
  retryBudget: TeamRetryBudgetContract;
  commitLane: TeamCommitLaneContract;
  brokerSubagent: TeamBrokerSubagentContract;
  editorSubagentBridge: TeamEditorSubagentBridgeContract;
};

type TeamClosureAttestationInput = {
  teamRunId?: unknown;
  runtimeContract?: Partial<TeamRuntimeContract> | null;
  runtimeMode?: unknown;
  runtimeLanguage?: unknown;
  runtimeAdapterId?: unknown;
  providerId?: unknown;
  sdkId?: unknown;
  modelId?: unknown;
  runnerKind?: unknown;
  runtimeVersion?: unknown;
  sandboxPolicyHash?: unknown;
  attestationSigner?: unknown;
  reviewerIndependence?: Partial<TeamClosureReviewerIndependenceEvidence> | null;
  attestedAt?: unknown;
};

type TeamEditorSubagentRoleEnvelope = {
  schemaId: 'atm.teamEditorSubagentRoleEnvelope.v1';
  agentId: string;
  role: string;
  profile: string | null;
  language: string | null;
  permissions: string[];
  allowedFiles: string[];
  leaseMetadata: {
    permissionLeases: PermissionLease[];
    leaseOwner: string;
  };
  artifactMetadata: {
    expectedReports: string[];
    evidenceRequired: string;
    consumesFrom: string[];
    producesTo: string[];
    requiredArtifacts: string[];
  };
  retryMetadata: {
    retryPolicy: 'atm-governed';
    maxAttempts: number;
  };
};

type TeamEditorSubagentBridgeContract = {
  schemaId: 'atm.teamEditorSubagentBridgeContract.v1';
  enabled: boolean;
  lifecycleOwner: 'atm';
  disabledReason: string | null;
  editorNeutral: true;
  allowedFiles: string[];
  roleEnvelopes: TeamEditorSubagentRoleEnvelope[];
};

type TeamPatrolFinding = {
  level: TeamPatrolFindingLevel;
  code: string;
  category: 'runtime-mode' | 'artifact-gap' | 'retry-budget' | 'rework-state' | 'scope' | 'evidence' | 'broker-governance';
  summary: string;
  suggestedCommand: string | null;
  details?: Record<string, unknown>;
};

const teamPermissionCatalog: TeamPermissionDefinition[] = [
  { id: 'task.lifecycle', mode: 'exclusive' },
  { id: 'git.write', mode: 'exclusive' },
  { id: 'file.read', mode: 'shareable', scopeRequired: true },
  { id: 'file.write', mode: 'exclusive', scopeRequired: true },
  { id: 'web.query', mode: 'exclusive' },
  { id: 'web.download', mode: 'exclusive', scopeRequired: true },
  { id: 'exec.validator', mode: 'shareable', scopeRequired: true },
  { id: 'exec.mutating', mode: 'exclusive', scopeRequired: true },
  { id: 'sandbox.write', mode: 'exclusive' },
  { id: 'pipeline.write', mode: 'exclusive', scopeRequired: true },
  { id: 'database.write', mode: 'exclusive', scopeRequired: true },
  { id: 'ci.write', mode: 'exclusive', scopeRequired: true },
  { id: 'evidence.write', mode: 'exclusive' }
];

const coordinatorExclusivePermissions = ['task.lifecycle', 'git.write', 'evidence.write'] as const;

const readOnlyTeamRoles = new Set([
  'atomizationPlanner',
  'scopeGuardian',
  'reader',
  'evidenceCollector',
  'validator'
]);

const writeTeamPermissions = new Set([
  'task.lifecycle',
  'git.write',
  'file.write',
  'evidence.write',
  'web.query',
  'web.download',
  'exec.mutating',
  'sandbox.write',
  'pipeline.write',
  'database.write',
  'ci.write'
]);

const atomizationRiskHotFiles = new Set([
  'tasks.ts',
  'next.ts',
  'evidence.ts',
  'hook.ts'
]);

const atomizationPlanningThreshold = 3;

export const TEAM_ATOM_BOUNDARIES = {
  'team.cli-entry': {
    anchor: 'packages/cli/src/commands/team.ts#runTeam',
    capability: 'Team CLI entry router for plan, start, status, and validate actions.',
    downstreamTasks: ['TASK-TEAM-0001']
  },
  'team.recipe-permission-model': {
    anchor: 'packages/cli/src/commands/team.ts#validateTeamPermissionModel',
    capability: 'Recipe catalog validation and scoped permission lease planning.',
    downstreamTasks: ['TASK-TEAM-0001']
  },
  'team.plan-crew-briefing-contract': {
    anchor: 'packages/cli/src/commands/team.ts#buildMinimalTaskCrewBriefingContract',
    capability: 'Minimal crew briefing contract with required roles, stop conditions, and parallel advisory.',
    downstreamTasks: ['TASK-TEAM-0002']
  },
  'team.plan-atomization-planner': {
    anchor: 'packages/cli/src/commands/team.ts#buildAtomizationChecklist',
    capability: 'Atomization planner advisory checklist for scope shape and split recommendations.',
    downstreamTasks: ['TASK-TEAM-0003']
  },
  'team.plan-task-0009-preflight': {
    anchor: 'docs/governance/team-agents/task-0009-preflight-contract.md',
    capability: 'TASK-TEAM-0009 preflight/referee contract covering dependency map, acceptance checklist, and mailbox materialization corrective dispatch rules.',
    downstreamTasks: ['TASK-TEAM-0009']
  },
  'team.plan-broker-lane': {
    anchor: 'packages/cli/src/commands/team.ts#planTeamBrokerLane',
    capability: 'Broker lane evaluation and steward/composer routing for team plan/start.',
    downstreamTasks: ['TASK-TEAM-0001', 'TASK-CID-0021']
  },
  'team.start-claim-gate-parity': {
    anchor: 'packages/cli/src/commands/team.ts#buildTeamClaimAdmissionFindings',
    capability: 'Team plan/start claim admission parity against normal task dependency gates.',
    downstreamTasks: ['TASK-TEAM-0029']
  },
  'team.captain-decision': {
    anchor: 'packages/cli/src/commands/team.ts#buildCaptainDecision',
    capability: 'Captain decision dry-run output for team sizing, required roles, confidence, and stop conditions.',
    downstreamTasks: ['TASK-TEAM-0007']
  },
  'team.implementer-selector': {
    anchor: 'packages/cli/src/commands/team.ts#selectTeamImplementer',
    capability: 'Deterministic implementer selector for Team Agents based on task paths, deliverables, language hints, and safe generic fallback.',
    downstreamTasks: ['TASK-TEAM-0010']
  },
  'team.start-runtime-state': {
    anchor: 'packages/cli/src/commands/team.ts#writeTeamRun',
    capability: 'Team run runtime record writer under .atm/runtime/team-runs.',
    downstreamTasks: ['TASK-TEAM-0011']
  },
  'team.status-runtime-read': {
    anchor: 'packages/cli/src/commands/team.ts#buildTeamStatusResult',
    capability: 'Read-only team run status surface.',
    downstreamTasks: ['TASK-TEAM-0011']
  },
  'team.runtime-mode-contract': {
    anchor: 'packages/cli/src/commands/team.ts#buildTeamRuntimeContract',
    capability: 'Neutral Team runtime mode and adapter metadata contract for real-agent, editor-subagent, and broker-only execution surfaces.',
    downstreamTasks: ['TASK-TEAM-0031']
  },
  'team.patrol-report': {
    anchor: 'packages/cli/src/commands/team.ts#buildTeamPatrolReport',
    capability: 'Read-only patrol report for runtime mode, broker-governance evidence gates, rework readiness, missing artifacts, and retry-budget risk.',
    downstreamTasks: ['TASK-TEAM-0014']
  },
  'team.permission-lease-validator': {
    anchor: 'packages/cli/src/commands/team.ts#validateTeamPermissionModel',
    capability: 'Deterministic permission lease validation before team runtime start.',
    downstreamTasks: ['TASK-TEAM-0012']
  },
  'team.file-write-scope-validator': {
    anchor: 'packages/cli/src/commands/team.ts#validateTeamPermissionModel',
    capability: 'Deterministic file.write lease scope validation against task allowed files before team runtime start.',
    downstreamTasks: ['TASK-TEAM-0013']
  },
  'team.lease-fencing-deadlock-contract': {
    anchor: 'packages/core/src/governance/scope-lock.ts#validateScopeLeaseFencing',
    capability: 'Team lease fencing diagnostics for duplicate exclusive owners, stale lease epochs, wait-for cycles, released tombstones, and allowedFiles write boundaries across real-agent, editor-subagent, and broker-only runs.',
    downstreamTasks: ['TASK-TEAM-0018']
  },
  'team.next-recommendation': {
    anchor: 'packages/cli/src/commands/team.ts#buildTeamRecommendation',
    capability: 'Advisory next/playbook teamRecommendation surface with plan/start/status/reason command hints without auto-running team commands.',
    downstreamTasks: ['TASK-TEAM-0015']
  },
  'team.knowledge-build-query': {
    anchor: 'packages/cli/src/commands/team-knowledge.ts#runTeamKnowledge',
    capability: 'Advisory Team Agents knowledge build/query dry-run surface with metadata filtering and lexical ranking.',
    downstreamTasks: ['TASK-TEAM-0021']
  },
  'team.broker-conflict-resolution': {
    anchor: 'packages/cli/src/commands/team.ts#runTeamBrokerConflictResolve',
    capability: 'Team Broker conflict resolve command that emits atm.brokerConflictResolution.v1 artifacts with decisionClass, decisionReason, violationStatus, and broker-conflict-blocked release-order semantics.',
    downstreamTasks: ['TASK-TEAM-0046']
  }
} as const;

export type TeamRecommendationChannel = 'fast' | 'normal' | 'batch';

export type TeamRecommendation = {
  readonly schemaId: 'atm.teamRecommendation.v1';
  readonly enabled: boolean;
  readonly required: false;
  readonly channel: TeamRecommendationChannel;
  readonly taskId: string;
  readonly recipeId: string;
  readonly reason: string;
  readonly plan: string;
  readonly start: string;
  readonly status: string;
  readonly validate: string;
  readonly constraints: readonly string[];
  readonly knowledgeSummary?: TeamKnowledgeSummary;
  readonly parallelAdvisory?: unknown;
};

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
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'file.write'] },
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
      { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
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
      { agentId: 'batch-coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
      { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
      { agentId: 'current-task-reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
      { agentId: 'current-task-scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
      { agentId: 'current-task-implementer', role: 'implementer', profile: 'atm.implementer.generic.v1', permissions: ['file.write'] },
      { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
      { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
    ]
  }
];

export async function runTeam(argv: string[]) {
  if (String(argv[0] ?? '').toLowerCase() === 'knowledge') {
    const cwd = path.resolve(readOptionValue(argv, '--cwd') ?? process.cwd());
    return runTeamKnowledge(argv.slice(1), cwd);
  }

  if (String(argv[0] ?? '').toLowerCase() === 'broker') {
    return runTeamBroker(argv.slice(1), process.cwd());
  }

  if (String(argv[0] ?? '').toLowerCase() === 'observability') {
    const cwd = path.resolve(readOptionValue(argv, '--cwd') ?? process.cwd());
    return runTeamObservability(argv.slice(1), cwd);
  }

  const spec = getCommandSpec('team')!;
  const parsed = parseArgsForCommand(spec, argv);
  const action = String(parsed.positional[0] ?? 'plan').toLowerCase();
  const cwd = path.resolve(String(parsed.options.cwd ?? process.cwd()));

  if (action === 'wave') {
    // TASK-MAO-0024: Team Agents Wave Mode planning surface.
    return runTeamWave(parsed.positional.slice(1).map(String), cwd);
  }

  if (action === 'knowledge') {
    const knowledgeArgv = argv[0]?.toLowerCase() === 'knowledge' ? argv.slice(1) : parsed.positional.slice(1).map(String);
    return runTeamKnowledge(knowledgeArgv, cwd);
  }

  if (action === 'broker') {
    return runTeamBroker(parsed.positional.slice(1).map(String), cwd);
  }

  if (action === 'observability') {
    return runTeamObservability(parsed.positional.slice(1).map(String), cwd);
  }

  if (!['plan', 'start', 'status', 'validate', 'patrol'].includes(action)) {
    throw new CliError('ATM_CLI_USAGE', 'team supports: plan, start, status, validate, patrol, wave, knowledge, broker resolve, observability query', { exitCode: 2 });
  }

  if (action === 'status') {
    return buildTeamStatusResult({
      cwd,
      requestedTeamRunId: String(parsed.options.team ?? '').trim(),
      compact: Boolean(parsed.options.compact)
    });
  }

  const taskId = String(parsed.options.task ?? '').trim();
  if (!taskId) {
    throw new CliError('ATM_TEAM_TASK_REQUIRED', `team ${action} requires --task <id>.`, { exitCode: 2 });
  }

  if (action === 'patrol') {
    return buildTeamPatrolResult({
      cwd,
      taskId,
      mode: normalizeTeamPatrolMode(parsed.options.mode),
      requestedTeamRunId: String(parsed.options.team ?? '').trim()
    });
  }

  const context = await buildTeamPlanningContext({
    cwd,
    taskId,
    requestedRecipeId: String(parsed.options.recipe ?? '').trim(),
    actorId: String(parsed.options.actor ?? process.env.ATM_ACTOR_ID ?? process.env.AGENT_IDENTITY ?? 'team-planner').trim()
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
    editorBridgeDisabled: parsed.options.disableEditorBridge,
    recipe,
    allowedFiles: deriveWritePaths(task, cwd),
    permissionLeases: teamPlan.suggestedPermissionLeases,
    evidenceRequired: String(task.evidenceRequired ?? 'command-backed')
  });

  if (action === 'validate') {
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
        brokerLane: teamPlan.brokerLane,
        sharedVocabulary: buildBrokerConflictSharedVocabulary(teamPlan.brokerLane),
        runtimeContract,
        runtimePilot: teamPlan.runtimePilot
      }
    });
  }

  if (action === 'start') {
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
    return makeResult({
      ok: true,
      command: 'team',
      cwd,
      messages: [
        message('info', 'ATM_TEAM_STARTED', 'Team run started. Runtime state was written, but no agents were spawned.', {
          teamRunId: teamRun.teamRunId,
          taskId,
          recipeId: recipe.recipeId
        })
      ],
      evidence: {
        action: 'start',
        runtimeWritten: true,
        agentsSpawned: runtimeContract.agentsSpawned,
        teamRunPath: `.atm/runtime/team-runs/${teamRun.teamRunId}.json`,
        teamRun,
        brokerLane: teamPlan.brokerLane,
        runtimeContract,
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
        ? 'Team plan dry-run completed. No runtime state was written and no agents were spawned.'
        : 'Team plan found permission conflicts. No runtime state was written and no agents were spawned.', {
        taskId,
        recipeId: recipe.recipeId,
        findingCount: validation.findings.length
      })
    ],
    evidence: {
      action: 'plan',
      dryRun: true,
      runtimeWritten: false,
      agentsSpawned: false,
      task: summarizeTask(taskId, task),
      recipe,
      recipeSources: recipes.sources,
      permissionCatalog: teamPermissionCatalog,
      validation,
      teamPlan,
      runtimeContract,
      brokerLane: teamPlan.brokerLane,
      sharedVocabulary: buildBrokerConflictSharedVocabulary(teamPlan.brokerLane),
      runtimePilot: teamPlan.runtimePilot
    }
  });
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

  const fixture = String(readOptionValue(argv, '--fixture') ?? 'broker-conflict-resolution').trim();
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
  const query = queryTeamObservabilityEvents(events, {
    taskId: readOptionValue(argv, '--task-filter') ?? readOptionValue(argv, '--task'),
    teamRunId: readOptionValue(argv, '--team-run-filter') ?? readOptionValue(argv, '--team-run'),
    providerId: readOptionValue(argv, '--provider-filter') ?? readOptionValue(argv, '--provider'),
    role: readOptionValue(argv, '--role-filter') ?? readOptionValue(argv, '--role'),
    artifactType: readOptionValue(argv, '--artifact') ?? readOptionValue(argv, '--artifact-type'),
    eventType: readOptionValue(argv, '--event-type') as any
  });

  return makeResult({
    ok: true,
    command: 'team observability query',
    mode: 'standalone',
    cwd: defaultCwd,
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
      contract: buildTeamObservabilityContract(),
      artifact,
      query
    }
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
      dryRun: true,
      runtimeWritten: false,
      agentsSpawned: false,
      artifact,
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
  const selectionDecision = input.selectionConfig
    ? resolveTeamProviderSelection(roleName, input.selectionConfig)
    : null;
  const editorBridgeDisabled = Boolean(input.editorBridgeDisabled);
  const workerAdapter = resolveNodejsTeamWorkerAdapter({
    runtimeMode: selectionDecision?.runtimeMode ?? runtimeMode,
    runtimeLanguage,
    runtimeAdapterId,
    providerId: providerId ?? selectionDecision?.providerId,
    sdkId: sdkId ?? selectionDecision?.sdkId,
    modelId: modelId ?? selectionDecision?.modelId
  });
  const agentsSpawned = workerAdapter.agentsSpawned;
  const executionSurface = workerAdapter.executionSurface;

  return {
    schemaId: 'atm.teamRuntimeContract.v1',
    runtimeMode: selectionDecision?.runtimeMode ?? runtimeMode,
    runtimeLanguage,
    runtimeAdapterId: runtimeAdapterId ?? workerAdapter.adapterId,
    providerId: providerId ?? selectionDecision?.providerId ?? workerAdapter.providerId,
    sdkId: sdkId ?? selectionDecision?.sdkId ?? workerAdapter.sdkId,
    modelId: modelId ?? selectionDecision?.modelId ?? workerAdapter.modelId,
    agentsSpawned,
    executionSurface,
    selectionReason: describeRuntimeSelection({
      runtimeMode: selectionDecision?.runtimeMode ?? runtimeMode,
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

export function buildTeamArtifactHandoffContract(input: {
  recipe?: TeamRecipe;
  requiredRoles?: readonly string[];
  producedArtifacts?: readonly string[];
}): TeamArtifactHandoffContract {
  const requiredRoles = uniqueStrings((input.requiredRoles ?? ['implementer', 'reviewer', 'validator', 'evidence-collector'])
    .map((entry) => String(entry).trim())
    .filter(Boolean));
  const recipeAgents = input.recipe?.agents ?? [];
  const roleContracts = requiredRoles.map((role) => {
    const agent = recipeAgents.find((entry) => entry.role === role);
    return buildTeamRoleArtifactContract({
      agentId: agent?.agentId ?? role,
      role
    });
  });
  const findings = validateTeamArtifactHandoff({
    roleContracts,
    producedArtifacts: input.producedArtifacts ?? []
  });
  return {
    schemaId: 'atm.teamArtifactHandoffContract.v1',
    requiredRoles,
    roleContracts,
    findings,
    closeAllowed: findings.every((finding) => !finding.blocking)
  };
}

export function validateTeamArtifactHandoff(input: {
  roleContracts: readonly TeamRoleArtifactContract[];
  producedArtifacts?: readonly string[];
}): TeamArtifactHandoffFinding[] {
  const producedArtifacts = new Set((input.producedArtifacts ?? []).map((entry) => normalizeArtifactName(entry)).filter(Boolean));
  const findings: TeamArtifactHandoffFinding[] = [];
  for (const contract of input.roleContracts) {
    for (const artifact of contract.requiredArtifacts) {
      const normalizedArtifact = normalizeArtifactName(artifact);
      if (!producedArtifacts.has(normalizedArtifact)) {
        findings.push({
          level: 'error',
          code: 'missing-required-artifact',
          role: contract.role,
          agentId: contract.agentId,
          artifact,
          blocking: true,
          summary: `${contract.role} requires artifact '${artifact}' before close.`
        });
      }
    }
  }
  return findings;
}

export function buildTeamRetryBudgetContract(input: {
  maxReworkCycles?: unknown;
  maxValidatorReruns?: unknown;
  maxReviewerReturns?: unknown;
  usedReworkCycles?: unknown;
  usedValidatorReruns?: unknown;
  usedReviewerReturns?: unknown;
  escalationTarget?: unknown;
}): TeamRetryBudgetContract {
  const maxReworkCycles = normalizeRetryBudget(input.maxReworkCycles, 1);
  const maxValidatorReruns = normalizeRetryBudget(input.maxValidatorReruns, 1);
  const maxReviewerReturns = normalizeRetryBudget(input.maxReviewerReturns, 1);
  const usedReworkCycles = normalizeRetryBudget(input.usedReworkCycles, 0);
  const usedValidatorReruns = normalizeRetryBudget(input.usedValidatorReruns, 0);
  const usedReviewerReturns = normalizeRetryBudget(input.usedReviewerReturns, 0);
  const exhausted = usedReworkCycles >= maxReworkCycles
    || usedValidatorReruns >= maxValidatorReruns
    || usedReviewerReturns >= maxReviewerReturns;
  const escalationTarget = normalizeOptionalRuntimeString(input.escalationTarget) ?? 'captain';
  return {
    schemaId: 'atm.teamRetryBudgetContract.v1',
    maxReworkCycles,
    maxValidatorReruns,
    maxReviewerReturns,
    usedReworkCycles,
    usedValidatorReruns,
    usedReviewerReturns,
    exhausted,
    escalationTarget: exhausted ? escalationTarget : null,
    status: exhausted ? 'escalation-required' : 'within-budget'
  };
}

export function buildTeamReworkRouteStateMachine(input: {
  findings?: readonly TeamReworkFinding[];
  requiredChecksPassed?: boolean;
  retryBudgetMax?: number;
  retryBudgetUsed?: number;
  previousStatus?: TeamReworkRouteStatus;
}): TeamReworkRoute {
  const maxAttempts = normalizeRetryBudget(input.retryBudgetMax, 1);
  const used = normalizeRetryBudget(input.retryBudgetUsed, 0);
  const remaining = Math.max(0, maxAttempts - used);
  const findings = normalizeTeamReworkFindings(input.findings ?? []);
  const requiredChecksPassed = input.requiredChecksPassed === true;
  const startingStatus = input.previousStatus ?? 'work-in-progress';
  const blockingReviewerFindings = findings.filter((finding) => finding.source === 'reviewer' && isBlockingReworkFinding(finding));
  const failedValidatorFindings = findings.filter((finding) => finding.source === 'validator' && finding.passed === false);
  const blockingFindings = [...blockingReviewerFindings, ...failedValidatorFindings];
  const transitions: TeamReworkTransition[] = [];
  let status = startingStatus;

  if (blockingFindings.length > 0) {
    status = pushTeamReworkTransition({
      transitions,
      from: status,
      to: remaining <= 0 ? 'blocked' : 'needs-rework',
      reason: remaining <= 0
        ? 'retry budget exhausted while blocking reviewer or validator findings remain'
        : 'blocking reviewer or validator findings require implementation rework',
      findingIds: blockingFindings.map((finding) => finding.id)
    });
  } else if (status === 'needs-rework') {
    status = pushTeamReworkTransition({
      transitions,
      from: status,
      to: 'revalidate-pending',
      reason: 'rework completed; validation must rerun before close readiness',
      findingIds: []
    });
  }

  if ((status === 'work-in-progress' || status === 'revalidate-pending') && requiredChecksPassed) {
    status = pushTeamReworkTransition({
      transitions,
      from: status,
      to: 'ready-for-close',
      reason: 'required reviewer and validator checks passed',
      findingIds: []
    });
  } else if (status === 'revalidate-pending' && remaining <= 0) {
    status = pushTeamReworkTransition({
      transitions,
      from: status,
      to: 'escalated',
      reason: 'revalidation is pending but retry budget is exhausted',
      findingIds: []
    });
  }

  return {
    schemaId: 'atm.teamReworkRoute.v1',
    status,
    retryBudget: {
      maxAttempts,
      used,
      remaining,
      escalationTarget: remaining <= 0 ? 'captain' : null
    },
    requiredChecksPassed,
    findings,
    transitions
  };
}

function buildTeamRoleArtifactContract(input: {
  agentId: string;
  role: string;
}): TeamRoleArtifactContract {
  const role = input.role;
  if (role === 'implementer') {
    return {
      schemaId: 'atm.teamRoleArtifactContract.v1',
      agentId: input.agentId,
      role,
      consumesFrom: ['task-card', 'team-plan', 'scope-locks'],
      producesTo: ['reviewer', 'validator', 'evidence-collector'],
      requiredArtifacts: ['implementation-diff', 'implementation-notes']
    };
  }
  if (role === 'reviewer') {
    return {
      schemaId: 'atm.teamRoleArtifactContract.v1',
      agentId: input.agentId,
      role,
      consumesFrom: ['implementation-diff', 'implementation-notes'],
      producesTo: ['implementer', 'evidence-collector'],
      requiredArtifacts: ['review-findings']
    };
  }
  if (role === 'validator') {
    return {
      schemaId: 'atm.teamRoleArtifactContract.v1',
      agentId: input.agentId,
      role,
      consumesFrom: ['implementation-diff', 'validator-commands'],
      producesTo: ['evidence-collector'],
      requiredArtifacts: ['validator-results']
    };
  }
  if (role === 'evidence-collector') {
    return {
      schemaId: 'atm.teamRoleArtifactContract.v1',
      agentId: input.agentId,
      role,
      consumesFrom: ['review-findings', 'validator-results'],
      producesTo: ['closure-packet'],
      requiredArtifacts: ['command-backed-evidence', 'closure-packet']
    };
  }
  return {
    schemaId: 'atm.teamRoleArtifactContract.v1',
    agentId: input.agentId,
    role,
    consumesFrom: ['team-plan'],
    producesTo: ['team-summary'],
    requiredArtifacts: ['role-report']
  };
}

function normalizeArtifactName(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function transitionTeamReworkRoute(
  current: TeamReworkRoute,
  input: {
    findings?: readonly TeamReworkFinding[];
    requiredChecksPassed?: boolean;
    retryBudgetUsed?: number;
  }
): TeamReworkRoute {
  const next = buildTeamReworkRouteStateMachine({
    findings: input.findings ?? current.findings,
    requiredChecksPassed: input.requiredChecksPassed ?? current.requiredChecksPassed,
    retryBudgetMax: current.retryBudget.maxAttempts,
    retryBudgetUsed: input.retryBudgetUsed ?? current.retryBudget.used,
    previousStatus: current.status
  });
  return {
    ...next,
    transitions: [...current.transitions, ...next.transitions]
  };
}

function normalizeTeamReworkFindings(findings: readonly TeamReworkFinding[]): TeamReworkFinding[] {
  return findings.map((finding, index) => ({
    source: finding.source === 'validator' ? 'validator' : 'reviewer',
    id: String(finding.id || `${finding.source || 'finding'}-${index + 1}`),
    blocking: finding.blocking === true,
    passed: typeof finding.passed === 'boolean' ? finding.passed : undefined,
    severity: normalizeFindingSeverity(finding.severity),
    summary: typeof finding.summary === 'string' ? finding.summary : undefined
  }));
}

function normalizeFindingSeverity(value: unknown): TeamReworkFinding['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' || value === 'blocker'
    ? value
    : undefined;
}

function isBlockingReworkFinding(finding: TeamReworkFinding): boolean {
  return finding.blocking === true || finding.severity === 'error' || finding.severity === 'blocker';
}

function normalizeRetryBudget(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function pushTeamReworkTransition(input: {
  transitions: TeamReworkTransition[];
  from: TeamReworkRouteStatus;
  to: TeamReworkRouteStatus;
  reason: string;
  findingIds: string[];
}): TeamReworkRouteStatus {
  if (input.from !== input.to) {
    input.transitions.push({
      from: input.from,
      to: input.to,
      reason: input.reason,
      findingIds: input.findingIds
    });
  }
  return input.to;
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

function describeRuntimeSelection(input: {
  runtimeMode: TeamRuntimeMode;
  runtimeLanguage: string;
  runtimeAdapterId: string | null;
  selectionSource?: 'repo-default' | 'role-override' | null;
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
}) {
  const task = readTask(input.cwd, input.taskId);
  const recipes = loadTeamRecipes(input.cwd);
  const recipe = selectRecipe({
    recipes,
    requestedRecipeId: input.requestedRecipeId,
    task
  });
  const writeScope = deriveTeamWriteScope(task, input.cwd);
  const writePaths = writeScope.writePaths;
  const permissionValidation = validateTeamPermissionModel(recipe, writePaths, {
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
    writePaths
  });
  const brokerLane = brokerLanePlan.evidence;
  const claimAdmissionFindings = buildTeamClaimAdmissionFindings(input.cwd, input.taskId, task);
  const validation = mergeValidation(
    permissionValidation,
    { ok: claimAdmissionFindings.every((f) => f.level !== 'error'), findings: claimAdmissionFindings },
    { ok: parallelFindings.every((f) => f.level !== 'error'), findings: parallelFindings },
    { ok: brokerLanePlan.findings.every((f) => f.level !== 'error'), findings: brokerLanePlan.findings }
  );

  const finalTeamPlan = buildTeamPlan({
    task,
    recipe,
    writePaths,
    validation,
    brokerLane,
    allowEmptyWriteScope: writeScope.allowEmptyWriteScope,
    knowledgeSummary: buildTeamKnowledgeSummary({
      cwd: input.cwd,
      taskId: String(task.workItemId ?? task.taskId ?? input.taskId),
      top: 3
    })
  });

  return {
    task,
    recipes,
    recipe,
    permissionValidation,
    validation,
    teamPlan: {
      ...finalTeamPlan,
      validation,
      brokerLane
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

export function validateTeamPermissionModel(
  recipe: TeamRecipe,
  writePaths: string[],
  options: TeamPermissionValidationOptions = {}
) {
  const agentRoles = new Map(recipe.agents.map((agent) => [agent.agentId, agent.role]));
  return mergeValidation(
    validateTeamRecipe(recipe, agentRoles),
    validatePermissionLeases(buildSuggestedPermissionLeases(recipe, writePaths, options), agentRoles, options)
  );
}

export function planTeamBrokerLane(input: {
  cwd: string;
  taskId: string;
  actorId: string;
  task: Record<string, unknown> | null | undefined;
  writePaths: string[];
}) {
  const brokerLaneResult = evaluateTeamBrokerLane(input);
  return {
    result: brokerLaneResult,
    evidence: buildTeamBrokerEvidence(brokerLaneResult),
    findings: brokerLaneToFindings(brokerLaneResult).map((finding) => buildPermissionFinding({
      level: finding.level,
      code: finding.code,
      detail: finding.detail,
      paths: finding.paths
    })) satisfies PermissionFinding[]
  };
}

function buildPermissionFinding(input: {
  level: 'error' | 'warning';
  code: string;
  detail: string;
  permission?: string;
  agentIds?: string[];
  paths?: string[];
  role?: string;
}): PermissionFinding {
  return {
    level: input.level,
    code: input.code,
    summary: permissionFindingSummary(input),
    detail: input.detail,
    role: input.role,
    permission: input.permission,
    agentIds: input.agentIds,
    paths: input.paths,
    suggestedFix: permissionFindingSuggestedFix(input)
  };
}

function permissionFindingSummary(input: {
  code: string;
  detail: string;
  permission?: string;
  role?: string;
}): string {
  switch (input.code) {
    case 'ATM_TEAM_PERMISSION_UNKNOWN':
      return input.permission
        ? `Unknown permission ${input.permission}.`
        : 'Unknown team permission.';
    case 'ATM_TEAM_PERMISSION_CONFLICT':
      return input.permission
        ? `Exclusive permission ${input.permission} has multiple recipe owners.`
        : 'Exclusive permission has multiple recipe owners.';
    case 'ATM_TEAM_UNIQUE_OWNER_REQUIRED':
      return input.permission
        ? `${input.permission} must stay with the coordinator.`
        : 'Coordinator-only permission has an invalid owner.';
    case 'ATM_TEAM_READONLY_ROLE_WRITE_FORBIDDEN':
      return input.role
        ? `Read-only role ${input.role} must not receive write permissions.`
        : 'Read-only role received a write permission.';
    case 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED':
      return input.permission
        ? `${input.permission} requires explicit scoped paths.`
        : 'Scoped permission is missing lease paths.';
    case 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN':
      return 'Write lease targets forbidden runtime paths.';
    case 'ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS':
      return 'Write lease includes paths outside the task write scope.';
    case 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL':
      return 'Write lease includes unsafe path traversal.';
    case 'ATM_TEAM_PERMISSION_LEASE_CONFLICT':
      return input.permission
        ? `Exclusive permission lease ${input.permission} has multiple owners.`
        : 'Exclusive permission lease has multiple owners.';
    case 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED':
      return 'Team start is blocked by task claim dependency gates.';
    default:
      return input.detail;
  }
}

function permissionFindingSuggestedFix(input: {
  code: string;
  permission?: string;
  role?: string;
  agentIds?: string[];
}): string {
  switch (input.code) {
    case 'ATM_TEAM_PERMISSION_UNKNOWN':
      return 'Remove the unknown permission or add it to the team permission catalog before team start.';
    case 'ATM_TEAM_PERMISSION_CONFLICT':
      return input.permission
        ? `Keep ${input.permission} on one role only and remove it from the other agent recipe entries.`
        : 'Assign each exclusive permission to exactly one agent in the recipe.';
    case 'ATM_TEAM_UNIQUE_OWNER_REQUIRED':
      return input.permission
        ? `Grant ${input.permission} only to the coordinator agent and remove it from other roles.`
        : 'Move coordinator-only permissions back to the coordinator agent.';
    case 'ATM_TEAM_READONLY_ROLE_WRITE_FORBIDDEN':
      return input.role
        ? `Remove write permissions from ${input.role}; keep read-only roles on file.read or exec.validator only.`
        : 'Remove write permissions from read-only roles in the recipe.';
    case 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED':
      return input.permission
        ? `Add explicit scoped paths to the ${input.permission} lease before team start.`
        : 'Provide scoped paths for permissions that require a lease boundary.';
    case 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN':
      return 'Remove .atm/runtime/** paths from write leases; runtime state is managed by team start, not leased writes.';
    case 'ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS':
      return 'Request a governed scope amendment or remove the path before team start.';
    case 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL':
      return 'Use repository-relative paths without .. segments or absolute drive roots.';
    case 'ATM_TEAM_PERMISSION_LEASE_CONFLICT':
      return input.permission
        ? `Rebuild suggested leases so only one agent owns ${input.permission}.`
        : 'Ensure each exclusive lease has a single owner before team start.';
    case 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED':
      return 'Close, verify, or reopen the dependency through the normal task lifecycle, then rerun team plan/start.';
    default:
      return 'Review the recipe permissions and suggested leases, then rerun team validate.';
  }
}

function resolveFindingRole(agentRoles: Map<string, string>, agentIds?: string[]): string | undefined {
  const primaryAgentId = agentIds?.[0];
  if (!primaryAgentId) return undefined;
  return agentRoles.get(primaryAgentId);
}

function validateTeamRecipe(recipe: TeamRecipe, agentRoles: Map<string, string>) {
  const permissionDefinitions = new Map(teamPermissionCatalog.map((entry) => [entry.id, entry]));
  const ownersByPermission = new Map<string, string[]>();
  const findings: PermissionFinding[] = [];

  for (const agent of recipe.agents) {
    for (const permission of agent.permissions) {
      if (!permissionDefinitions.has(permission)) {
        findings.push(buildPermissionFinding({
          level: 'error',
          code: 'ATM_TEAM_PERMISSION_UNKNOWN',
          detail: `Unknown team permission: ${permission}`,
          permission,
          agentIds: [agent.agentId],
          role: agent.role
        }));
      }
      if (readOnlyTeamRoles.has(agent.role) && writeTeamPermissions.has(permission)) {
        findings.push(buildPermissionFinding({
          level: 'error',
          code: 'ATM_TEAM_READONLY_ROLE_WRITE_FORBIDDEN',
          detail: `Read-only role ${agent.role} must not receive write permission ${permission}.`,
          permission,
          agentIds: [agent.agentId],
          role: agent.role
        }));
      }
      ownersByPermission.set(permission, [...(ownersByPermission.get(permission) ?? []), agent.agentId]);
    }
  }

  for (const permission of teamPermissionCatalog.filter((entry) => entry.mode === 'exclusive')) {
    const owners = ownersByPermission.get(permission.id) ?? [];
    if (owners.length > 1) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_PERMISSION_CONFLICT',
        detail: `Exclusive permission ${permission.id} has multiple owners.`,
        permission: permission.id,
        agentIds: owners,
        role: resolveFindingRole(agentRoles, owners)
      }));
    }
  }

  const coordinator = recipe.agents.find((agent) => agent.role === 'coordinator');
  for (const permission of coordinatorExclusivePermissions) {
    const owners = ownersByPermission.get(permission) ?? [];
    if (owners.length !== 1 || owners[0] !== coordinator?.agentId) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_UNIQUE_OWNER_REQUIRED',
        detail: `${permission} must have exactly one owner and it must be the coordinator.`,
        permission,
        agentIds: owners,
        role: resolveFindingRole(agentRoles, owners)
      }));
    }
  }

  return {
    ok: findings.every((finding) => finding.level !== 'error'),
    findings
  };
}

function validatePermissionLeases(
  leases: PermissionLease[],
  agentRoles: Map<string, string>,
  options: TeamPermissionValidationOptions = {}
) {
  const permissionDefinitions = new Map(teamPermissionCatalog.map((entry) => [entry.id, entry]));
  const findings: PermissionFinding[] = [];
  const ownersByExclusivePermission = new Map<string, string[]>();
  const allowedWritePathSet = new Set((options.allowedWritePaths ?? []).map((entry) => normalizeTeamLeasePath(entry, options.repoRoot)).filter(Boolean));

  for (const lease of leases) {
    const definition = permissionDefinitions.get(lease.permission);
    const role = agentRoles.get(lease.agentId);
    if (!definition) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_PERMISSION_UNKNOWN',
        detail: `Unknown team permission lease: ${lease.permission}`,
        permission: lease.permission,
        agentIds: [lease.agentId],
        role
      }));
      continue;
    }
    if (definition.mode === 'exclusive') {
      ownersByExclusivePermission.set(lease.permission, [
        ...(ownersByExclusivePermission.get(lease.permission) ?? []),
        lease.agentId
      ]);
    }
    if (definition.scopeRequired && (!Array.isArray(lease.paths) || lease.paths.length === 0) && !options.allowEmptyWriteScope) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED',
        detail: `${lease.permission} requires explicit scoped paths.`,
        permission: lease.permission,
        agentIds: [lease.agentId],
        role
      }));
    }
    const normalizedLeasePaths = (lease.paths ?? []).map((entry) => ({
      raw: entry,
      normalized: normalizeTeamLeasePath(entry, options.repoRoot)
    }));
    const unsafeTraversalPaths = normalizedLeasePaths
      .filter((entry) => isUnsafeTeamLeasePath(entry.raw, entry.normalized, options.repoRoot))
      .map((entry) => entry.raw);
    if (unsafeTraversalPaths.length > 0) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL',
        detail: `${lease.permission} cannot lease path traversal or absolute paths: ${unsafeTraversalPaths.join(', ')}`,
        permission: lease.permission,
        agentIds: [lease.agentId],
        role,
        paths: unsafeTraversalPaths
      }));
    }
    const forbiddenRuntimePaths = normalizedLeasePaths
      .filter((entry) => entry.normalized.startsWith('.atm/runtime/') || entry.normalized === '.atm/runtime')
      .map((entry) => entry.raw);
    const forbiddenHistoryPaths = normalizedLeasePaths
      .filter((entry) => entry.normalized.startsWith('.atm/history/') || entry.normalized === '.atm/history')
      .map((entry) => entry.raw);
    const forbiddenWritePaths = uniqueStrings([...forbiddenRuntimePaths, ...forbiddenHistoryPaths]);
    if (forbiddenWritePaths.length > 0) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN',
        detail: `${lease.permission} cannot lease ATM managed runtime/history paths: ${forbiddenWritePaths.join(', ')}`,
        permission: lease.permission,
        agentIds: [lease.agentId],
        role,
        paths: forbiddenWritePaths
      }));
    }
    if (lease.permission === 'file.write' && allowedWritePathSet.size > 0) {
      const outOfBoundsPaths = normalizedLeasePaths
        .filter((entry) => entry.normalized && !allowedWritePathSet.has(entry.normalized))
        .map((entry) => entry.raw);
      if (outOfBoundsPaths.length > 0) {
        findings.push(buildPermissionFinding({
          level: 'error',
          code: 'ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS',
          detail: `file.write lease paths are outside task allowedFiles/deliverables: ${outOfBoundsPaths.join(', ')}`,
          permission: lease.permission,
          agentIds: [lease.agentId],
          role,
          paths: outOfBoundsPaths
        }));
      }
    }
  }

  return finalizeLeaseValidation(findings, ownersByExclusivePermission, agentRoles);
}

function finalizeLeaseValidation(
  findings: PermissionFinding[],
  ownersByExclusivePermission: Map<string, string[]>,
  agentRoles: Map<string, string>
) {
  for (const [permission, owners] of ownersByExclusivePermission.entries()) {
    if (new Set(owners).size > 1) {
      findings.push(buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_PERMISSION_LEASE_CONFLICT',
        detail: `Exclusive permission lease ${permission} has multiple owners.`,
        permission,
        agentIds: owners,
        role: resolveFindingRole(agentRoles, owners)
      }));
    }
  }

  return {
    ok: findings.every((finding) => finding.level !== 'error'),
    findings
  };
}

function normalizeTeamLeasePath(value: string, repoRoot?: string) {
  const raw = String(value).trim();
  const repoRelative = normalizeRepoAbsoluteLeasePath(raw, repoRoot);
  const normalized = path.posix.normalize((repoRelative ?? raw).replace(/\\/g, '/'));
  return normalized === '.' ? '' : normalized.replace(/^\.\//, '');
}

function normalizeRepoAbsoluteLeasePath(rawPath: string, repoRoot?: string) {
  if (!repoRoot) return null;
  const raw = String(rawPath).trim();
  const normalizedRaw = raw.replace(/\\/g, '/');
  if (!/^[A-Za-z]:\//.test(normalizedRaw) && !normalizedRaw.startsWith('/')) return null;

  const root = path.resolve(repoRoot);
  const candidate = path.resolve(raw);
  const relative = path.relative(root, candidate);
  if (!relative || relative === '') return '';
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.replace(/\\/g, '/');
}

function isUnsafeTeamLeasePath(rawPath: string, normalizedPath: string, repoRoot?: string) {
  const raw = String(rawPath).trim().replace(/\\/g, '/');
  const repoRelative = normalizeRepoAbsoluteLeasePath(rawPath, repoRoot);
  const unsafeAbsolute = (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) && repoRelative === null;
  return unsafeAbsolute
    || raw === '..'
    || raw.startsWith('../')
    || raw.includes('/../')
    || normalizedPath === '..'
    || normalizedPath.startsWith('../');
}

function deriveAllowedWriteScope(task: Record<string, unknown> | null | undefined, repoRoot?: string) {
  const explicitAllowed = normalizeTaskPathArray((task as { targetAllowedFiles?: unknown })?.targetAllowedFiles, repoRoot);
  if (explicitAllowed.length > 0) {
    return uniqueStrings(explicitAllowed);
  }
  return normalizeTaskWriteScope([
    ...normalizeTaskPathArray((task as { deliverables?: unknown })?.deliverables, repoRoot),
    ...normalizeTaskPathArray((task as { scopePaths?: unknown })?.scopePaths, repoRoot)
  ], repoRoot);
}

function normalizeTaskWriteScope(paths: string[], repoRoot?: string) {
  return uniqueStrings(paths.map((entry) => normalizeTeamLeasePath(entry, repoRoot)).filter(Boolean));
}

function mergeValidation(...reports: { ok: boolean; findings: PermissionFinding[] }[]) {
  const findings = reports.flatMap((report) => report.findings);
  return {
    ok: findings.every((finding) => finding.level !== 'error'),
    findings
  };
}

function buildSuggestedPermissionLeases(recipe: TeamRecipe, writePaths: string[], options: TeamPermissionValidationOptions = {}): PermissionLease[] {
  const coordinator = recipe.agents.find((agent) => agent.role === 'coordinator') ?? null;
  const fileWriteOwner = recipe.agents.find((agent) => agent.permissions.includes('file.write')) ?? null;
  return [
    ...(coordinator ? [
      { permission: 'task.lifecycle', agentId: coordinator.agentId },
      { permission: 'git.write', agentId: coordinator.agentId },
      { permission: 'evidence.write', agentId: coordinator.agentId }
    ] : []),
    ...(fileWriteOwner && (writePaths.length > 0 || !options.allowEmptyWriteScope) ? [{
      permission: 'file.write',
      agentId: fileWriteOwner.agentId,
      paths: writePaths
    }] : [])
  ] satisfies PermissionLease[];
}

export function buildTeamPlan(input: {
  task: Record<string, unknown> | null | undefined;
  recipe: TeamRecipe;
  writePaths: string[];
  validation: { ok: boolean; findings: PermissionFinding[] };
  brokerLane: TeamBrokerLaneEvidence;
  allowEmptyWriteScope?: boolean;
  knowledgeSummary?: TeamKnowledgeSummary;
}) {
  const atomizationChecklist = buildAtomizationChecklist(input.task, input.writePaths);
  const crewBriefingContract = buildMinimalTaskCrewBriefingContract(input.task, input.writePaths, input.validation, input.brokerLane);
  const implementerSelector = selectTeamImplementer(input.task, input.recipe, input.writePaths);
  const captainDecision = buildCaptainDecision(input.task, input.writePaths, input.validation, input.brokerLane, crewBriefingContract, atomizationChecklist, implementerSelector);
  const roleSkillPacks = buildTeamRoleSkillPackContract(input.recipe);
  const roleSkillPackManifest = buildProviderNeutralRoleSkillPackManifest({ recipe: input.recipe, roleSkillPacks });
  const routingMatrix = buildTeamRoleRoutingMatrix(roleSkillPacks);
  const growthContract = buildTeamGrowthContract();
  const observabilityContract = buildTeamObservabilityContract();
  const roleGrowthObservabilityContract = buildTeamRoleGrowthObservabilityContract({
    roleSkillPacks,
    growthContract
  });
  const runtimePilot = buildTeamRuntimePilot({
    roleSkillPacks,
    routingMatrix,
    growthContract,
    validation: input.validation,
    brokerLane: input.brokerLane
  });
  return {
    schemaId: 'atm.teamPlan.v1',
    recipeId: input.recipe.recipeId,
    channelHint: 'normal',
    brokerLane: input.brokerLane,
    agents: input.recipe.agents,
    captainDecision,
    implementerSelector,
    roleSkillPacks,
    roleSkillPackManifest,
    routingMatrix,
    growthContract,
    observabilityContract,
    roleGrowthObservabilityContract,
    openAIFamilyRuntimeBridges: buildOpenAIFamilyRuntimeBridgeSummary(),
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

export function buildOpenAIFamilyRuntimeBridgeSummary(): TeamOpenAIFamilyRuntimeBridgeSummary {
  return {
    schemaId: 'atm.openAIFamilyRuntimeBridgeSummary.v1',
    milestone: 'M9I',
    providerIds: ['openai', 'azure-openai'],
    sharedProviderInterface: 'atm.teamProviderContract.v1',
    sharedArtifactType: 'atm.teamProviderRunArtifact.v1',
    observabilityEventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
    coordinatorOwnedAuthority: true,
    brokerConflictVocabulary: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked'],
    bridges: [
      buildOpenAITeamProviderBridgeDescriptor(),
      buildAzureOpenAITeamProviderBridgeDescriptor()
    ]
  };
}

export function buildTeamRoleSkillPackContract(recipe: TeamRecipe): TeamRoleSkillPackContract {
  const rolePackDefaults: Record<string, { skillPackId: string; specialistSkills: string[]; playbookSlice: string }> = {
    coordinator: {
      skillPackId: 'atm.role-pack.coordinator',
      specialistSkills: ['atm-governance-router', 'atm-next', 'atm-handoff'],
      playbookSlice: 'route-claim-close-commit'
    },
    reader: {
      skillPackId: 'atm.role-pack.reader',
      specialistSkills: ['atm-orient'],
      playbookSlice: 'source-read-discovery'
    },
    scopeGuardian: {
      skillPackId: 'atm.role-pack.scope-guardian',
      specialistSkills: ['atm-lock'],
      playbookSlice: 'scope-preflight-boundary-watch'
    },
    implementer: {
      skillPackId: 'atm.role-pack.implementer',
      specialistSkills: ['atm-task-intent-resolver'],
      playbookSlice: 'scoped-delivery'
    },
    validator: {
      skillPackId: 'atm.role-pack.validator',
      specialistSkills: ['atm-evidence'],
      playbookSlice: 'validator-evidence-pass'
    },
    evidenceCollector: {
      skillPackId: 'atm.role-pack.evidence-collector',
      specialistSkills: ['atm-evidence', 'atm-handoff'],
      playbookSlice: 'evidence-summary-handoff'
    },
    atomizationPlanner: {
      skillPackId: 'atm.role-pack.atomization-planner',
      specialistSkills: ['atm-atom-map-refactor', 'atm-task-card-authoring'],
      playbookSlice: 'atomization-scope-shaping'
    }
  };
  const coordinatorExclusive = ['task.lifecycle', 'git.write', 'evidence.write'];
  return {
    schemaId: 'atm.teamRoleSkillPackContract.v1',
    providerNeutral: true,
    coordinatorOwnsLifecycle: true,
    roles: recipe.agents.map((agent) => {
      const defaults = rolePackDefaults[agent.role] ?? {
        skillPackId: `atm.role-pack.${agent.role}`,
        specialistSkills: [],
        playbookSlice: 'specialist-advisory'
      };
      return {
        role: agent.role,
        agentId: agent.agentId,
        skillPackId: defaults.skillPackId,
        specialistSkills: defaults.specialistSkills,
        allowedPermissions: [...agent.permissions],
        forbiddenPermissions: agent.role === 'coordinator' ? [] : coordinatorExclusive,
        playbookSlice: defaults.playbookSlice,
        growthContractAttachment: 'shared-team-growth-contract'
      };
    })
  };
}

export function buildProviderNeutralRoleSkillPackManifest(input: {
  recipe: TeamRecipe;
  roleSkillPacks?: TeamRoleSkillPackContract;
  selectionConfig?: TeamProviderSelectionConfig;
  providerIds?: readonly string[];
}): TeamRoleSkillPackManifest {
  const roleSkillPacks = input.roleSkillPacks ?? buildTeamRoleSkillPackContract(input.recipe);
  const selectionConfig = input.selectionConfig ?? {
    repoDefault: {
      providerId: 'openai',
      sdkId: 'responses',
      modelId: 'gpt-5-mini',
      runtimeMode: 'broker-only'
    },
    roleOverrides: {}
  };
  const providerIds = uniqueStrings([...(input.providerIds ?? TEAM_PROVIDER_IDS)]);

  return {
    schemaId: 'atm.teamRoleSkillPackManifest.v1',
    providerNeutral: true,
    coordinatorOwnsLifecycle: true,
    discoveryMode: 'capability-driven',
    roleFirstProviderSecond: true,
    sharedVocabulary: {
      brokerConflict: ['decisionClass', 'decisionReason', 'violationStatus', 'broker-conflict-blocked']
    },
    roles: roleSkillPacks.roles.map((entry) => {
      const selection = resolveTeamProviderSelection(entry.role, selectionConfig);
      return {
        role: entry.role,
        skillPackId: entry.skillPackId,
        playbookSlice: entry.playbookSlice,
        capabilityTags: capabilityTagsForRole(entry.role),
        permissionLease: {
          alignment: 'role-first',
          allowedPermissions: entry.allowedPermissions,
          forbiddenPermissions: entry.forbiddenPermissions
        },
        selectedProvider: {
          providerId: selection.providerId,
          sdkId: selection.sdkId,
          modelId: selection.modelId,
          runtimeMode: selection.runtimeMode,
          source: selection.source
        },
        providerCapabilities: providerIds.map((providerId) => ({
          providerId,
          runtimeModes: ['real-agent', 'editor-subagent', 'broker-only'],
          artifacts: artifactsForRole(entry.role),
          satisfiesRolePack: true as const,
          reason: `${providerId} can satisfy ${entry.skillPackId} through role-first permission leases and ${entry.playbookSlice}.`
        })),
        growthContractAttachment: entry.growthContractAttachment
      };
    })
  };
}

export function buildTeamRoleRoutingMatrix(roleSkillPacks: TeamRoleSkillPackContract): TeamRoleRoutingMatrix {
  const hasRole = (role: string) => roleSkillPacks.roles.some((entry) => entry.role === role);
  const maybe = (role: string) => hasRole(role) ? [role] : [];
  const route = (input: {
    workstream: string;
    primaryRole: string;
    supportingRoles?: string[];
    advisoryRoles?: string[];
    roleOrder: string[];
    parallelSafeRoles?: string[];
    advisoryOnlyRoles?: string[];
    playbookSlice: string;
    stopConditions?: string[];
  }) => ({
    workstream: input.workstream,
    primaryRole: input.primaryRole,
    supportingRoles: input.supportingRoles ?? [],
    advisoryRoles: input.advisoryRoles ?? [],
    roleOrder: input.roleOrder,
    parallelSafeRoles: input.parallelSafeRoles ?? [],
    advisoryOnlyRoles: input.advisoryOnlyRoles ?? input.advisoryRoles ?? [],
    playbookSlice: input.playbookSlice,
    lifecycleOwner: 'coordinator' as const,
    stopConditions: input.stopConditions ?? [
      'broker-conflict-blocked',
      'blocked-active-lease',
      'proposal-submitted'
    ]
  });
  return {
    schemaId: 'atm.teamRoleRoutingMatrix.v1',
    providerNeutral: true,
    coordinatorOwnsLifecycle: true,
    routes: [
      route({
        workstream: 'task-entry-routing',
        primaryRole: 'coordinator',
        supportingRoles: [...maybe('reader'), ...maybe('scopeGuardian')],
        advisoryRoles: [...maybe('evidenceCollector')],
        roleOrder: ['coordinator', ...maybe('scopeGuardian'), ...maybe('reader'), ...maybe('evidenceCollector')],
        parallelSafeRoles: [...maybe('reader'), ...maybe('evidenceCollector')],
        playbookSlice: 'route-claim-close-commit'
      }),
      route({
        workstream: 'scoped-implementation',
        primaryRole: hasRole('implementer') ? 'implementer' : 'coordinator',
        supportingRoles: [...maybe('scopeGuardian')],
        advisoryRoles: [...maybe('reader')],
        roleOrder: ['coordinator', ...maybe('scopeGuardian'), hasRole('implementer') ? 'implementer' : 'coordinator', ...maybe('reader')],
        parallelSafeRoles: [...maybe('scopeGuardian'), ...maybe('reader')],
        playbookSlice: 'scoped-delivery'
      }),
      route({
        workstream: 'validation-and-evidence',
        primaryRole: hasRole('validator') ? 'validator' : 'coordinator',
        supportingRoles: [...maybe('evidenceCollector')],
        advisoryRoles: [...maybe('reader')],
        roleOrder: ['coordinator', hasRole('validator') ? 'validator' : 'coordinator', ...maybe('evidenceCollector'), ...maybe('reader')],
        parallelSafeRoles: [...maybe('evidenceCollector'), ...maybe('reader')],
        playbookSlice: 'validator-evidence-pass'
      }),
      route({
        workstream: 'broker-conflict-resolution',
        primaryRole: 'coordinator',
        supportingRoles: [...maybe('scopeGuardian')],
        advisoryRoles: [...maybe('reader'), ...maybe('evidenceCollector')],
        roleOrder: ['coordinator', ...maybe('scopeGuardian'), ...maybe('reader'), ...maybe('evidenceCollector')],
        parallelSafeRoles: [...maybe('reader'), ...maybe('evidenceCollector')],
        playbookSlice: 'broker-conflict-resolution',
        stopConditions: [
          'broker-conflict-blocked',
          'missing-atm.brokerConflictResolution.v1',
          'manual-runtime-edit-requested'
        ]
      })
    ]
  };
}

function capabilityTagsForRole(role: string): string[] {
  const normalized = role.toLowerCase();
  if (normalized === 'coordinator') return ['task-routing', 'lifecycle-authority', 'closeout-sequencing'];
  if (normalized.includes('scope')) return ['scope-boundary', 'broker-preflight', 'lease-watch'];
  if (normalized.includes('implementer')) return ['scoped-delivery', 'bounded-file-write'];
  if (normalized.includes('validator')) return ['validator-run', 'failure-interpretation'];
  if (normalized.includes('evidence')) return ['evidence-packaging', 'closure-readiness'];
  if (normalized.includes('knowledge')) return ['knowledge-query', 'shared-growth-context'];
  if (normalized.includes('steward')) return ['broker-authorized-apply', 'bounded-merge-plan'];
  return ['specialist-advisory'];
}

function artifactsForRole(role: string): string[] {
  const normalized = role.toLowerCase();
  if (normalized === 'coordinator') return ['captain-decision', 'team-brief', 'handoff'];
  if (normalized.includes('validator')) return ['validator-report'];
  if (normalized.includes('evidence')) return ['evidence-summary'];
  if (normalized.includes('implementer')) return ['agent-report', 'patch-summary'];
  if (normalized.includes('scope')) return ['scope-report'];
  if (normalized.includes('knowledge')) return ['knowledge-summary'];
  if (normalized.includes('steward')) return ['broker-apply-report'];
  return ['agent-report'];
}

export function buildTeamGrowthContract(): TeamGrowthContract {
  return {
    schemaId: 'atm.teamGrowthContract.v1',
    sharedAcrossRolePacks: true,
    taxonomy: [
      'entry-friction',
      'route-confusion',
      'boundary-confusion',
      'fallback-misuse',
      'validator-gap',
      'tooling-mismatch',
      'overloaded-context',
      'shared-atm-routing-friction',
      'role-specific-friction'
    ],
    captureTemplate: [
      'Trigger',
      'Symptom',
      'Correct route',
      'Durable rule',
      'Promotion target',
      'Reuse scope'
    ],
    promotionPolicy: {
      stableRuleTarget: 'SKILL.md',
      rawCaseTarget: 'docs/governance/team-agents/role-pack-learning-loop.md'
    }
  };
}

export function buildTeamRoleGrowthObservabilityContract(input: {
  roleSkillPacks: TeamRoleSkillPackContract;
  growthContract?: TeamGrowthContract;
}): TeamRoleGrowthObservabilityContract {
  const growthContract = input.growthContract ?? buildTeamGrowthContract();
  const learningReference = growthContract.promotionPolicy.rawCaseTarget;
  return {
    schemaId: 'atm.teamRoleGrowthObservabilityContract.v1',
    sharedAcrossRolePacks: true,
    referenceFirst: true,
    sourceGrowthContract: 'atm.teamGrowthContract.v1',
    sourceObservabilityContract: 'atm.teamAgentObservabilityContract.v1',
    learningEventProjection: {
      eventSchemaId: 'atm.teamAgentObservabilityEvent.v1',
      eventType: 'artifact.output',
      artifactType: 'atm.teamRoleGrowthLearningItem.v1',
      queryKeys: ['taskId', 'teamRunId', 'providerId', 'role', 'artifactType', 'eventType'],
      artifactFields: [
        'Category',
        'Trigger',
        'Symptom',
        'Correct route',
        'Durable rule',
        'Promotion target',
        'Confidence',
        'Reuse scope'
      ]
    },
    frictionClassification: {
      sharedAtmRoutingFriction: [
        'entry-friction',
        'route-confusion',
        'fallback-misuse',
        'tooling-mismatch',
        'shared-atm-routing-friction'
      ],
      roleSpecificFriction: [
        'boundary-confusion',
        'validator-gap',
        'overloaded-context',
        'role-specific-friction'
      ]
    },
    roleMappings: input.roleSkillPacks.roles.map((entry) => ({
      role: entry.role,
      agentId: entry.agentId,
      skillPackId: entry.skillPackId,
      playbookSlice: entry.playbookSlice,
      growthAttachmentPoint: entry.growthContractAttachment,
      learningReference,
      taxonomy: growthContract.taxonomy,
      observableEventSelector: {
        role: entry.role,
        eventType: 'artifact.output',
        artifactType: 'atm.teamRoleGrowthLearningItem.v1'
      }
    })),
    metrics: [
      {
        metricId: 'role-growth.learning-events.by-role',
        description: 'Counts reference-first role learning artifacts by role and skill pack.',
        numerator: {
          eventType: 'artifact.output',
          artifactType: 'atm.teamRoleGrowthLearningItem.v1'
        },
        denominator: {
          eventType: 'artifact.output',
          artifactType: 'atm.teamRoleGrowthLearningItem.v1'
        },
        groupedBy: ['role', 'skillPackId', 'playbookSlice']
      },
      {
        metricId: 'role-growth.role-specific-friction.rate',
        description: 'Separates role-boundary friction from shared ATM routing friction.',
        numerator: {
          category: 'role-specific-friction'
        },
        denominator: {
          artifactType: 'atm.teamRoleGrowthLearningItem.v1'
        },
        groupedBy: ['role', 'skillPackId']
      },
      {
        metricId: 'broker-conflict-blocked.hit-rate',
        description: 'Tracks how often Team role growth observes the M8E broker-conflict-blocked state.',
        numerator: {
          violationStatus: 'broker-conflict-blocked'
        },
        denominator: {
          eventType: 'broker.conflict.blocked'
        },
        groupedBy: ['role', 'taskId', 'decisionClass']
      }
    ],
    brokerConflictVocabulary: {
      decisionClass: 'decisionClass',
      decisionReason: 'decisionReason',
      violationStatus: 'violationStatus',
      blockedCode: 'broker-conflict-blocked'
    }
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
    decisionClass: blockedByBroker ? 'blocked' : 'allowed',
    decisionReason: input.brokerLane.blockedReasons[0] ?? input.brokerLane.decision.reason ?? 'Team Broker allowed the runtime pilot lane.',
    violationStatus: blockedByBroker
      ? brokerViolationStatus === 'proposal-submitted'
        ? 'proposal-submitted'
        : 'broker-conflict-blocked'
      : 'allowed',
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

function buildCaptainDecision(
  task: Record<string, unknown> | null | undefined,
  writePaths: string[],
  validation: { ok: boolean; findings: PermissionFinding[] },
  brokerLane: TeamBrokerLaneEvidence,
  crewBriefingContract: ReturnType<typeof buildMinimalTaskCrewBriefingContract>,
  atomizationChecklist: ReturnType<typeof buildAtomizationChecklist>,
  implementerSelector: TeamImplementerSelector
) {
  const sizing = decideTeamSizing(task, writePaths, validation, brokerLane);
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
    brokerLane: input.teamPlan.brokerLane,
    captainDecision: input.teamPlan.captainDecision,
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
      teamRuns: input.compact ? runs.map(compactTeamRun) : runs
    }
  });
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

function listTeamRuns(cwd: string) {
  const directory = teamRunsDirectory(cwd);
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((entry) => entry.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => readJsonFile(path.join(directory, entry), 'ATM_TEAM_RUN_INVALID'));
}

function findLatestTeamRunForTask(cwd: string, taskId: string) {
  const runs = listTeamRuns(cwd)
    .filter((run: unknown) => typeof run === 'object' && run !== null && (run as Record<string, unknown>).taskId === taskId)
    .sort((left: unknown, right: unknown) => String((right as Record<string, unknown>).updatedAt ?? (right as Record<string, unknown>).createdAt ?? '').localeCompare(String((left as Record<string, unknown>).updatedAt ?? (left as Record<string, unknown>).createdAt ?? '')));
  return runs[0] ?? null;
}

function readTeamRun(cwd: string, teamRunId: string) {
  const filePath = path.join(teamRunsDirectory(cwd), `${teamRunId}.json`);
  if (!existsSync(filePath)) {
    throw new CliError('ATM_TEAM_RUN_NOT_FOUND', `Team run not found: ${teamRunId}`, {
      exitCode: 2,
      details: { teamRunId, path: path.relative(cwd, filePath).replace(/\\/g, '/') }
    });
  }
  return readJsonFile(filePath, 'ATM_TEAM_RUN_INVALID');
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

interface PatrolRun {
  teamRunId?: string;
  executionMode?: string;
  agentsSpawned?: boolean;
  brokerSubagent?: {
    enabled?: boolean;
    schemaId?: string;
    decisionSurface?: string;
    stewardId?: string;
    evidenceRequired?: unknown;
    authorityBoundary?: {
      fileWrite?: boolean;
      gitWrite?: boolean;
      taskLifecycle?: boolean;
      selfClose?: boolean;
    };
  };
  runtimeContract?: {
    brokerSubagent?: {
      enabled?: boolean;
      schemaId?: string;
      decisionSurface?: string;
      stewardId?: string;
      evidenceRequired?: unknown;
      authorityBoundary?: {
        fileWrite?: boolean;
        gitWrite?: boolean;
        taskLifecycle?: boolean;
        selfClose?: boolean;
      };
    };
    commitLane?: {
      serializedBy?: string;
      ownerRole?: string;
      workerGitWrite?: boolean;
    };
    artifactHandoff?: {
      findings?: Array<{ blocking?: boolean; summary?: string; role?: string; agentId?: string; artifact?: string }>;
    };
  };
  commitLane?: {
    serializedBy?: string;
    ownerRole?: string;
    workerGitWrite?: boolean;
  };
  artifactHandoff?: {
    findings?: Array<{ blocking?: boolean; summary?: string; role?: string; agentId?: string; artifact?: string }>;
  };
  reworkRoute?: {
    status?: string;
    retryBudgetRemaining?: number;
    retryBudget?: {
      remaining?: number;
    };
  };
  reworkStatus?: string;
  retryBudget?: {
    status?: string;
    exhausted?: boolean;
  };
}

function buildTeamRunPatrolFindings(teamRun: Record<string, unknown> | null | undefined, input: { taskId: string; mode: TeamPatrolMode }): TeamPatrolFinding[] {
  const findings: TeamPatrolFinding[] = [];
  if (!teamRun) return findings;
  const run = teamRun as PatrolRun;
  if (run.executionMode !== 'manual-team') {
    findings.push(teamPatrolFinding({
      level: 'warning',
      code: 'ATM_TEAM_PATROL_RUNTIME_MODE_UNEXPECTED',
      category: 'runtime-mode',
      summary: `Team run ${run.teamRunId} is not in manual-team execution mode.`,
      suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
      details: { executionMode: run.executionMode ?? null }
    }));
  }
  if (run.agentsSpawned === true) {
    findings.push(teamPatrolFinding({
      level: 'warning',
      code: 'ATM_TEAM_PATROL_AGENTS_SPAWNED',
      category: 'runtime-mode',
      summary: `Team run ${run.teamRunId} reports spawned agents; coordinator should verify advisory role boundaries.`,
      suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`
    }));
  }
  const brokerSubagent = run.brokerSubagent ?? run.runtimeContract?.brokerSubagent ?? null;
  if (!brokerSubagent || brokerSubagent.enabled !== true) {
    findings.push(teamPatrolFinding({
      level: 'blocker',
      code: 'ATM_TEAM_PATROL_BROKER_SUBAGENT_MISSING',
      category: 'broker-governance',
      summary: `Team run ${run.teamRunId} does not expose an enabled broker subagent contract.`,
      suggestedCommand: `node atm.mjs team start --task ${quoteCliValue(input.taskId)} --actor <actor> --json`,
      details: { schemaId: brokerSubagent?.schemaId ?? null, enabled: brokerSubagent?.enabled ?? null }
    }));
  } else {
    if (brokerSubagent.decisionSurface !== 'brokerLane' || brokerSubagent.stewardId !== 'neutral-write-steward') {
      findings.push(teamPatrolFinding({
        level: 'warning',
        code: 'ATM_TEAM_PATROL_BROKER_SUBAGENT_DRIFT',
        category: 'broker-governance',
        summary: `Team run ${run.teamRunId} broker subagent contract does not match the expected broker lane steward.`,
        suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
        details: {
          decisionSurface: brokerSubagent.decisionSurface ?? null,
          stewardId: brokerSubagent.stewardId ?? null
        }
      }));
    }
    const expectedEvidenceRequired = [
      'atm.teamBrokerLaneEvidence.v1',
      'atm.stewardApplyEvidence.v1',
      'atm.brokerOperationRunRecordEnvelope.v1'
    ];
    const evidenceRequired = normalizeStringArray(brokerSubagent.evidenceRequired);
    const missingEvidence = expectedEvidenceRequired.filter((entry) => !evidenceRequired.includes(entry));
    if (missingEvidence.length > 0) {
      findings.push(teamPatrolFinding({
        level: 'blocker',
        code: 'ATM_TEAM_PATROL_BROKER_EVIDENCE_GATE_DRIFT',
        category: 'broker-governance',
        summary: `Team run ${run.teamRunId} broker subagent evidence gates are incomplete.`,
        suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
        details: {
          evidenceRequired,
          expectedEvidenceRequired,
          missingEvidence
        }
      }));
    }
    const boundary = brokerSubagent.authorityBoundary ?? {};
    if (boundary.fileWrite === true || boundary.gitWrite === true || boundary.taskLifecycle === true || boundary.selfClose === true) {
      findings.push(teamPatrolFinding({
        level: 'blocker',
        code: 'ATM_TEAM_PATROL_BROKER_SUBAGENT_AUTHORITY_DRIFT',
        category: 'broker-governance',
        summary: `Team run ${run.teamRunId} broker subagent authority boundary is too broad.`,
        suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
        details: { authorityBoundary: boundary }
      }));
    }
  }
  const commitLane = run.commitLane ?? run.runtimeContract?.commitLane ?? null;
  if (commitLane && (
    commitLane.serializedBy !== 'branch-commit-queue'
    || commitLane.ownerRole !== 'coordinator'
    || commitLane.workerGitWrite === true
  )) {
    findings.push(teamPatrolFinding({
      level: 'blocker',
      code: 'ATM_TEAM_PATROL_COMMIT_LANE_DRIFT',
      category: 'broker-governance',
      summary: `Team run ${run.teamRunId} commit lane no longer enforces coordinator-owned serialized commits.`,
      suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
      details: {
        serializedBy: commitLane.serializedBy ?? null,
        ownerRole: commitLane.ownerRole ?? null,
        workerGitWrite: commitLane.workerGitWrite ?? null
      }
    }));
  }
  const artifactFindings = Array.isArray(run.artifactHandoff?.findings)
    ? run.artifactHandoff.findings
    : Array.isArray(run.runtimeContract?.artifactHandoff?.findings)
      ? run.runtimeContract.artifactHandoff.findings
      : [];
  for (const artifactFinding of artifactFindings) {
    if (artifactFinding?.blocking === true) {
      findings.push(teamPatrolFinding({
        level: input.mode === 'close-preflight' ? 'blocker' : 'warning',
        code: 'ATM_TEAM_PATROL_ARTIFACT_HANDOFF_BLOCKED',
        category: 'artifact-gap',
        summary: String(artifactFinding.summary ?? 'Team role artifact handoff has a missing required artifact.'),
        suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
        details: {
          role: artifactFinding.role ?? null,
          agentId: artifactFinding.agentId ?? null,
          artifact: artifactFinding.artifact ?? null
        }
      }));
    }
  }
  const remaining = extractRetryBudgetRemaining(teamRun);
  if (remaining !== null && remaining <= 0) {
    findings.push(teamPatrolFinding({
      level: 'blocker',
      code: 'ATM_TEAM_PATROL_RETRY_BUDGET_EXHAUSTED',
      category: 'retry-budget',
      summary: `Team run ${run.teamRunId} has no retry budget remaining.`,
      suggestedCommand: `node atm.mjs team patrol --task ${quoteCliValue(input.taskId)} --mode close-preflight --team ${quoteCliValue(String(run.teamRunId))} --json`,
      details: { retryBudgetRemaining: remaining }
    }));
  }
  const reworkStatus = String(run.reworkRoute?.status ?? run.reworkStatus ?? '').trim();
  if (['needs-rework', 'blocked', 'stale'].includes(reworkStatus)) {
    findings.push(teamPatrolFinding({
      level: reworkStatus === 'blocked' ? 'blocker' : 'warning',
      code: 'ATM_TEAM_PATROL_REWORK_ROUTE_ATTENTION',
      category: 'rework-state',
      summary: `Team run ${run.teamRunId} rework route is ${reworkStatus}.`,
      suggestedCommand: `node atm.mjs team status --team ${quoteCliValue(String(run.teamRunId))} --json`,
      details: { reworkStatus }
    }));
  }
  if (reworkStatus === 'ready-for-close' && input.mode === 'close-preflight') {
    findings.push(teamPatrolFinding({
      level: 'info',
      code: 'ATM_TEAM_PATROL_REWORK_ROUTE_READY_FOR_CLOSE',
      category: 'rework-state',
      summary: `Team run ${run.teamRunId} rework route is ready-for-close.`,
      suggestedCommand: `node atm.mjs taskflow pre-close --task ${quoteCliValue(input.taskId)} --actor <actor> --json`,
      details: { reworkStatus }
    }));
  }
  return findings;
}

function extractRetryBudgetRemaining(teamRun: Record<string, unknown> | null | undefined): number | null {
  const run = teamRun as PatrolRun | null | undefined;
  const retryBudget = run?.retryBudget ?? run?.runtimeContract?.brokerSubagent ?? null; // 使用 brokerSubagent 的 retryBudget 或者是對應的 fallback
  if ((retryBudget as { status?: unknown })?.status === 'escalation-required' || (retryBudget as { exhausted?: unknown })?.exhausted === true) {
    return 0;
  }
  const candidates = [
    run?.reworkRoute?.retryBudgetRemaining,
    run?.reworkRoute?.retryBudget?.remaining
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return null;
}

function teamPatrolFinding(input: TeamPatrolFinding): TeamPatrolFinding {
  return input;
}

function summarizePatrolSeverity(findings: TeamPatrolFinding[]): TeamPatrolFindingLevel {
  if (findings.some((finding) => finding.level === 'blocker')) return 'blocker';
  if (findings.some((finding) => finding.level === 'warning')) return 'warning';
  return 'info';
}

function suggestedPatrolCommand(taskId: string, mode: TeamPatrolMode, severity: TeamPatrolFindingLevel) {
  if (severity === 'blocker') {
    return `node atm.mjs taskflow pre-close --task ${quoteCliValue(taskId)} --actor <actor> --json`;
  }
  if (mode === 'claim-preflight') {
    return `node atm.mjs next --claim --task ${quoteCliValue(taskId)} --actor <actor> --json`;
  }
  if (mode === 'close-preflight') {
    return `node atm.mjs taskflow pre-close --task ${quoteCliValue(taskId)} --actor <actor> --json`;
  }
  return `node atm.mjs team patrol --task ${quoteCliValue(taskId)} --mode ${mode} --json`;
}

function buildTeamPatrolFollowUp(taskId: string, mode: TeamPatrolMode, findings: TeamPatrolFinding[]) {
  const commands = uniqueStrings(findings.map((finding) => finding.suggestedCommand).filter((entry): entry is string => Boolean(entry)));
  if (commands.length > 0) return commands;
  if (mode === 'close-preflight') {
    return [`node atm.mjs taskflow pre-close --task ${quoteCliValue(taskId)} --actor <actor> --json`];
  }
  return [`node atm.mjs team plan --task ${quoteCliValue(taskId)} --json`];
}

interface CompactRunInput {
  teamRunId?: unknown;
  taskId?: unknown;
  recipeId?: unknown;
  actorId?: unknown;
  status?: unknown;
  roles?: unknown[];
  agents?: unknown[];
  leases?: unknown[];
  permissionLeases?: unknown[];
  brokerSubagent?: {
    enabled?: boolean;
    decisionSurface?: unknown;
    stewardId?: unknown;
    evidenceRequired?: unknown;
  };
  runtimeContract?: {
    brokerSubagent?: {
      enabled?: boolean;
      decisionSurface?: unknown;
      stewardId?: unknown;
      evidenceRequired?: unknown;
    };
    commitLane?: {
      serializedBy?: unknown;
      ownerRole?: unknown;
    };
    workerAdapter?: {
      authorityBoundary?: {
        gitWrite?: boolean;
        taskLifecycle?: boolean;
        selfClose?: boolean;
      };
    };
  };
  teamSummary?: {
    brokerGovernance?: {
      schemaId?: unknown;
      brokerEvidenceRequired?: unknown;
      commitLaneSerializedBy?: unknown;
      commitLaneOwnerRole?: unknown;
      workerGitWrite?: boolean;
      workerTaskLifecycle?: boolean;
      workerSelfClose?: boolean;
    };
  };
  runtimePilot?: {
    selectedRoles?: unknown;
  };
  agentsSpawned?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function compactTeamRun(run: Record<string, unknown> | null | undefined) {
  if (!run) return {};
  const r = run as CompactRunInput;
  const brokerGovernance = r.teamSummary?.brokerGovernance ?? null;
  const roles = r.roles;
  const agents = r.agents;
  const leases = r.leases;
  const permissionLeases = r.permissionLeases;
  const brokerSubagent = r.brokerSubagent;
  const runtimeContract = r.runtimeContract;
  return {
    teamRunId: r.teamRunId,
    taskId: r.taskId,
    recipeId: r.recipeId,
    actorId: r.actorId,
    status: r.status,
    roleCount: Array.isArray(roles) ? roles.length : Array.isArray(agents) ? agents.length : 0,
    leaseCount: Array.isArray(leases) ? leases.length : Array.isArray(permissionLeases) ? permissionLeases.length : 0,
    brokerSubagentEnabled: brokerSubagent?.enabled === true || runtimeContract?.brokerSubagent?.enabled === true,
    brokerDecisionSurface: brokerSubagent?.decisionSurface ?? runtimeContract?.brokerSubagent?.decisionSurface ?? null,
    brokerStewardId: brokerSubagent?.stewardId ?? runtimeContract?.brokerSubagent?.stewardId ?? null,
    brokerGovernanceSummaryId: brokerGovernance?.schemaId ?? null,
    runtimePilotMode: (run as { runtimePilot?: { pilotMode?: unknown } })?.runtimePilot?.pilotMode ?? null,
    runtimePilotRoles: normalizeStringArray(r.runtimePilot?.selectedRoles),
    brokerEvidenceRequired: normalizeStringArray(
      brokerGovernance?.brokerEvidenceRequired ?? brokerSubagent?.evidenceRequired ?? runtimeContract?.brokerSubagent?.evidenceRequired
    ),
    commitLaneSerializedBy: brokerGovernance?.commitLaneSerializedBy ?? runtimeContract?.commitLane?.serializedBy ?? null,
    commitLaneOwnerRole: brokerGovernance?.commitLaneOwnerRole ?? runtimeContract?.commitLane?.ownerRole ?? null,
    workerGitWrite: brokerGovernance?.workerGitWrite ?? runtimeContract?.workerAdapter?.authorityBoundary?.gitWrite ?? null,
    workerTaskLifecycle: brokerGovernance?.workerTaskLifecycle ?? runtimeContract?.workerAdapter?.authorityBoundary?.taskLifecycle ?? null,
    workerSelfClose: brokerGovernance?.workerSelfClose ?? runtimeContract?.workerAdapter?.authorityBoundary?.selfClose ?? null,
    agentsSpawned: r.agentsSpawned === true,
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null
  };
}

function teamRunsDirectory(cwd: string) {
  return path.join(cwd, '.atm', 'runtime', 'team-runs');
}

function createTeamRunId(taskId: string, actorId: string, createdAt: string) {
  const digest = createHash('sha256')
    .update(`${taskId}\n${actorId}\n${createdAt}`)
    .digest('hex')
    .slice(0, 12);
  return `team-${digest}`;
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

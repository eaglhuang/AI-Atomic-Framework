import type { TeamClosureReviewerIndependenceEvidence } from '../../evidence.ts';
import type { TeamKnowledgeSummary } from '../../team-knowledge.ts';
import type { TeamWorkerAdapterContract } from '../../../../../core/src/team-runtime/nodejs-worker-adapter.ts';

export type TeamPermissionMode = 'exclusive' | 'shareable';

export type TeamPermissionDefinition = {
  id: string;
  mode: TeamPermissionMode;
  scopeRequired?: boolean;
  /** Permission leases are always enforced by a fail-closed hard gate. */
  hardGate: true;
};

export type TeamVendorLocalSecrets = {
  schemaId: 'atm.teamVendorSecrets.local.v1';
  providers?: Record<string, Record<string, unknown>>;
  env?: Record<string, unknown>;
};

export type TeamVendorLocalSecretsSummary = {
  schemaId: 'atm.teamVendorLocalSecretsSummary.v1';
  path: string;
  loaded: boolean;
  providerCount: number;
  secretRefCount: number;
  secretRefs: string[];
  warningCount: number;
  warnings: string[];
  rawSecretsLogged: false;
};

export type TeamRecipeAgent = {
  agentId: string;
  role: string;
  profile?: string;
  language?: string;
  permissions: string[];
};

export type TeamRecipe = {
  schemaId: 'atm.teamRecipe.v1';
  recipeId: string;
  appliesTo?: string[];
  language?: string;
  agents: TeamRecipeAgent[];
};

export type TeamLevel = 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export type PermissionFinding = {
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

export type PermissionLease = {
  permission: string;
  agentId: string;
  paths?: string[];
};

export type TeamPermissionLeaseSummary = {
  permission: string;
  agentId: string;
  paths: string[];
  releaseCommand: string;
};

export type TeamLifecycleAction = 'lease' | 'release' | 'complete' | 'abandon';
export type TeamGovernanceRuntimeFields = {
  schemaId: 'atm.teamGovernanceRuntimeFields.v1';
  decisionClass: 'auto-execution' | 'human-signoff-required' | 'adr-required' | 'blocked';
  decisionReason: string;
  requiresHumanSignoff: boolean;
  requiresAdr: boolean;
  violationStatus: 'none' | 'warning' | 'broker-conflict-blocked' | 'human-signoff-required' | 'adr-required' | 'blocked';
  escalationTarget: string | null;
};

export type ReviewerIdentity = {
  providerId: string;
  modelId: string;
  modelCertificationId?: string | null;
};

export type TeamPermissionValidationOptions = {
  allowedWritePaths?: string[];
  repoRoot?: string;
  allowEmptyWriteScope?: boolean;
};

export type TeamCrewRole = {
  role: string;
  agentId: string;
  required: boolean;
  permissions: string[];
  description: string;
};

export type TeamRuntimePilot = {
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
    violationStatus: 'none' | 'proposal-submitted' | 'broker-conflict-blocked';
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

export type TeamImplementerSelector = {
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

export type TeamPatrolMode = 'claim-preflight' | 'close-preflight' | 'big-script' | 'daily-noon';

export type TeamPatrolFindingLevel = 'info' | 'warning' | 'blocker';

export type TeamRuntimeMode = 'real-agent' | 'editor-subagent' | 'broker-only';
export type TeamReworkRouteStatus =
  | 'work-in-progress'
  | 'needs-rework'
  | 'revalidate-pending'
  | 'ready-for-close'
  | 'blocked'
  | 'escalated';

export type TeamReworkFinding = {
  source: 'reviewer' | 'validator';
  id: string;
  blocking?: boolean;
  passed?: boolean;
  severity?: 'info' | 'warning' | 'error' | 'blocker';
  summary?: string;
};

export type TeamReworkTransition = {
  from: TeamReworkRouteStatus;
  to: TeamReworkRouteStatus;
  reason: string;
  findingIds: string[];
};

export type TeamReworkRoute = {
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

export type TeamRoleArtifactContract = {
  schemaId: 'atm.teamRoleArtifactContract.v1';
  agentId: string;
  role: string;
  consumesFrom: string[];
  producesTo: string[];
  requiredArtifacts: string[];
};

export type TeamArtifactHandoffFinding = {
  level: 'info' | 'warning' | 'error';
  code: string;
  role: string;
  agentId: string;
  artifact: string | null;
  blocking: boolean;
  summary: string;
};

export type TeamArtifactHandoffContract = {
  schemaId: 'atm.teamArtifactHandoffContract.v1';
  requiredRoles: string[];
  roleContracts: TeamRoleArtifactContract[];
  findings: TeamArtifactHandoffFinding[];
  closeAllowed: boolean;
};

export type TeamRetryBudgetContract = {
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

export type TeamCommitLaneContract = {
  schemaId: 'atm.teamCommitLaneContract.v1';
  ownerRole: 'coordinator';
  ownerPermissions: readonly ['task.lifecycle', 'git.write', 'evidence.write'];
  workerGitWrite: false;
  serializedBy: 'branch-commit-queue';
  lockSchemaId: 'atm.branchCommitQueueLock.v1';
  retryableCodes: readonly ['ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY', 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE'];
};

export type TeamBrokerSubagentContract = {
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

export type TeamRuntimeContract = {
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

export type TeamClosureAttestationInput = {
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

export type TeamEditorSubagentRoleEnvelope = {
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

export type TeamEditorSubagentBridgeContract = {
  schemaId: 'atm.teamEditorSubagentBridgeContract.v1';
  enabled: boolean;
  lifecycleOwner: 'atm';
  disabledReason: string | null;
  editorNeutral: true;
  allowedFiles: string[];
  roleEnvelopes: TeamEditorSubagentRoleEnvelope[];
};

export type TeamPatrolFinding = {
  level: TeamPatrolFindingLevel;
  code: string;
  category: 'runtime-mode' | 'artifact-gap' | 'retry-budget' | 'rework-state' | 'scope' | 'evidence' | 'broker-governance';
  summary: string;
  suggestedCommand: string | null;
  details?: Record<string, unknown>;
};

export const teamPermissionCatalog: TeamPermissionDefinition[] = [
  { id: 'task.lifecycle', mode: 'exclusive', hardGate: true },
  { id: 'git.write', mode: 'exclusive', hardGate: true },
  { id: 'file.read', mode: 'shareable', scopeRequired: true, hardGate: true },
  { id: 'file.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
  { id: 'web.query', mode: 'exclusive', hardGate: true },
  { id: 'web.download', mode: 'exclusive', scopeRequired: true, hardGate: true },
  { id: 'exec.validator', mode: 'shareable', scopeRequired: true, hardGate: true },
  { id: 'exec.mutating', mode: 'exclusive', scopeRequired: true, hardGate: true },
  { id: 'sandbox.write', mode: 'exclusive', hardGate: true },
  { id: 'pipeline.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
  { id: 'database.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
  { id: 'ci.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
  { id: 'evidence.write', mode: 'exclusive', hardGate: true },
  { id: 'knowledge.query', mode: 'shareable', hardGate: true },
  { id: 'knowledge.index.write', mode: 'exclusive', scopeRequired: true, hardGate: true },
  { id: 'review.signature.write', mode: 'exclusive', hardGate: true },
  { id: 'handoff.read', mode: 'shareable', scopeRequired: true, hardGate: true },
  { id: 'handoff.materialize', mode: 'exclusive', scopeRequired: true, hardGate: true }
];

export const coordinatorExclusivePermissions = ['task.lifecycle', 'git.write', 'evidence.write'] as const;

export const readOnlyTeamRoles = new Set([
  'atomizationPlanner',
  'scopeGuardian',
  'reader',
  'evidenceCollector',
  'validator',
  'lieutenant',
  'reviewAgent',
  'knowledgeScout'
]);

export const writeTeamPermissions = new Set([
  'task.lifecycle',
  'git.write',
  'file.write',
  'evidence.write',
  'review.signature.write',
  'web.query',
  'web.download',
  'knowledge.index.write',
  'exec.mutating',
  'sandbox.write',
  'pipeline.write',
  'database.write',
  'ci.write'
]);

export const atomizationRiskHotFiles = new Set([
  'tasks.ts',
  'next.ts',
  'evidence.ts',
  'hook.ts'
]);

export const atomizationPlanningThreshold = 3;

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

export type BatchTeamAdmissionDecision = {
  readonly schemaId: 'atm.batchTeamAdmissionDecision.v1';
  readonly taskId: string;
  readonly batchId: string;
  readonly allowed: boolean;
  readonly mode: 'team-current-head' | 'single-agent';
  readonly reasonCodes: readonly string[];
  readonly queueHeadOnly: true;
  readonly structuralParallelismRequired: true;
  readonly costTelemetryRequired: true;
  readonly stopLossAction: 'none' | 'single-agent' | 'cheaper-qualified-model-mix';
};


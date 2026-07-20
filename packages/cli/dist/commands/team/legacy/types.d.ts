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
export type TeamReworkRouteStatus = 'work-in-progress' | 'needs-rework' | 'revalidate-pending' | 'ready-for-close' | 'blocked' | 'escalated';
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
export declare const teamPermissionCatalog: TeamPermissionDefinition[];
export declare const coordinatorExclusivePermissions: readonly ["task.lifecycle", "git.write", "evidence.write"];
export declare const readOnlyTeamRoles: Set<string>;
export declare const writeTeamPermissions: Set<string>;
export declare const atomizationRiskHotFiles: Set<string>;
export declare const atomizationPlanningThreshold = 3;
export declare const TEAM_ATOM_BOUNDARIES: {
    readonly 'team.cli-entry': {
        readonly anchor: "packages/cli/src/commands/team.ts#runTeam";
        readonly capability: "Team CLI entry router for plan, start, status, and validate actions.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0001"];
    };
    readonly 'team.recipe-permission-model': {
        readonly anchor: "packages/cli/src/commands/team.ts#validateTeamPermissionModel";
        readonly capability: "Recipe catalog validation and scoped permission lease planning.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0001"];
    };
    readonly 'team.plan-crew-briefing-contract': {
        readonly anchor: "packages/cli/src/commands/team.ts#buildMinimalTaskCrewBriefingContract";
        readonly capability: "Minimal crew briefing contract with required roles, stop conditions, and parallel advisory.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0002"];
    };
    readonly 'team.plan-atomization-planner': {
        readonly anchor: "packages/cli/src/commands/team.ts#buildAtomizationChecklist";
        readonly capability: "Atomization planner advisory checklist for scope shape and split recommendations.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0003"];
    };
    readonly 'team.plan-task-0009-preflight': {
        readonly anchor: "docs/governance/team-agents/task-0009-preflight-contract.md";
        readonly capability: "TASK-TEAM-0009 preflight/referee contract covering dependency map, acceptance checklist, and mailbox materialization corrective dispatch rules.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0009"];
    };
    readonly 'team.plan-broker-lane': {
        readonly anchor: "packages/cli/src/commands/team.ts#planTeamBrokerLane";
        readonly capability: "Broker lane evaluation and steward/composer routing for team plan/start.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0001", "TASK-CID-0021"];
    };
    readonly 'team.start-claim-gate-parity': {
        readonly anchor: "packages/cli/src/commands/team.ts#buildTeamClaimAdmissionFindings";
        readonly capability: "Team plan/start claim admission parity against normal task dependency gates.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0029"];
    };
    readonly 'team.captain-decision': {
        readonly anchor: "packages/cli/src/commands/team.ts#buildCaptainDecision";
        readonly capability: "Captain decision dry-run output for team sizing, required roles, confidence, and stop conditions.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0007"];
    };
    readonly 'team.implementer-selector': {
        readonly anchor: "packages/cli/src/commands/team.ts#selectTeamImplementer";
        readonly capability: "Deterministic implementer selector for Team Agents based on task paths, deliverables, language hints, and safe generic fallback.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0010"];
    };
    readonly 'team.start-runtime-state': {
        readonly anchor: "packages/cli/src/commands/team.ts#writeTeamRun";
        readonly capability: "Team run runtime record writer under .atm/runtime/team-runs.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0011"];
    };
    readonly 'team.status-runtime-read': {
        readonly anchor: "packages/cli/src/commands/team.ts#buildTeamStatusResult";
        readonly capability: "Read-only team run status surface.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0011"];
    };
    readonly 'team.runtime-mode-contract': {
        readonly anchor: "packages/cli/src/commands/team.ts#buildTeamRuntimeContract";
        readonly capability: "Neutral Team runtime mode and adapter metadata contract for real-agent, editor-subagent, and broker-only execution surfaces.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0031"];
    };
    readonly 'team.patrol-report': {
        readonly anchor: "packages/cli/src/commands/team.ts#buildTeamPatrolReport";
        readonly capability: "Read-only patrol report for runtime mode, broker-governance evidence gates, rework readiness, missing artifacts, and retry-budget risk.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0014"];
    };
    readonly 'team.permission-lease-validator': {
        readonly anchor: "packages/cli/src/commands/team.ts#validateTeamPermissionModel";
        readonly capability: "Deterministic permission lease validation before team runtime start.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0012"];
    };
    readonly 'team.file-write-scope-validator': {
        readonly anchor: "packages/cli/src/commands/team.ts#validateTeamPermissionModel";
        readonly capability: "Deterministic file.write lease scope validation against task allowed files before team runtime start.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0013"];
    };
    readonly 'team.lease-fencing-deadlock-contract': {
        readonly anchor: "packages/core/src/governance/scope-lock.ts#validateScopeLeaseFencing";
        readonly capability: "Team lease fencing diagnostics for duplicate exclusive owners, stale lease epochs, wait-for cycles, released tombstones, and allowedFiles write boundaries across real-agent, editor-subagent, and broker-only runs.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0018"];
    };
    readonly 'team.next-recommendation': {
        readonly anchor: "packages/cli/src/commands/team.ts#buildTeamRecommendation";
        readonly capability: "Advisory next/playbook teamRecommendation surface with plan/start/status/reason command hints without auto-running team commands.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0015"];
    };
    readonly 'team.knowledge-build-query': {
        readonly anchor: "packages/cli/src/commands/team-knowledge.ts#runTeamKnowledge";
        readonly capability: "Advisory Team Agents knowledge build/query dry-run surface with metadata filtering and lexical ranking.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0021"];
    };
    readonly 'team.broker-conflict-resolution': {
        readonly anchor: "packages/cli/src/commands/team.ts#runTeamBrokerConflictResolve";
        readonly capability: "Team Broker conflict resolve command that emits atm.brokerConflictResolution.v1 artifacts with decisionClass, decisionReason, violationStatus, and broker-conflict-blocked release-order semantics.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0046"];
    };
};
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

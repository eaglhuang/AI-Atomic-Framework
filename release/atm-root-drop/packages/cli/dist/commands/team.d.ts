import { type TeamClosureAttestationEvidence, type TeamClosureReviewerIndependenceEvidence } from './evidence.ts';
import { type TeamKnowledgeSummary } from './team-knowledge.ts';
import { type TeamBrokerLaneEvidence } from '../../../core/src/broker/team-lane.ts';
import { type TeamWorkerAdapterContract } from '../../../core/src/team-runtime/nodejs-worker-adapter.ts';
import { type TeamProviderSelectionConfig } from '../../../core/src/team-runtime/provider-selection.ts';
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
type TeamRoleRoutingMatrix = {
    schemaId: 'atm.teamRoleRoutingMatrix.v1';
    providerNeutral: true;
    coordinatorOwnsLifecycle: true;
    routes: Array<{
        workstream: string;
        primaryRole: string;
        supportingRoles: string[];
        advisoryRoles: string[];
        playbookSlice: string;
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
type TeamRuntimePilot = {
    schemaId: 'atm.teamRuntimePilot.v1';
    providerNeutral: true;
    coordinatorOwnsLifecycle: true;
    pilotMode: 'role-pair' | 'role-trio';
    selectedRoles: string[];
    selectedSkillPackIds: string[];
    realisticWorkflow: string[];
    roleBoundarySignals: string[];
    lifecycleAuthority: {
        ownerRole: string;
        forbiddenToWorkers: string[];
    };
    roleConfusionReduction: string[];
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
type TeamReworkRouteStatus = 'work-in-progress' | 'needs-rework' | 'revalidate-pending' | 'ready-for-close' | 'blocked' | 'escalated';
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
export declare function resolveTeamRecipeIdForChannel(channel: TeamRecommendationChannel): string;
export declare function defaultTeamRecommendationReason(channel: TeamRecommendationChannel): string;
export declare function buildTeamRecommendation(input: {
    readonly taskId: string | null | undefined;
    readonly actorId?: string;
    readonly channel: TeamRecommendationChannel;
    readonly reason?: string;
    readonly enabled?: boolean;
    readonly knowledgeSummary?: TeamKnowledgeSummary;
    readonly parallelAdvisory?: unknown;
}): TeamRecommendation | null;
export declare function runTeam(argv: string[]): Promise<import("./shared.ts").CommandResult>;
export declare function buildTeamRuntimeContract(input: {
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
}): TeamRuntimeContract;
export declare function buildTeamClosureAttestation(input: TeamClosureAttestationInput): TeamClosureAttestationEvidence;
export declare function buildTeamArtifactHandoffContract(input: {
    recipe?: TeamRecipe;
    requiredRoles?: readonly string[];
    producedArtifacts?: readonly string[];
}): TeamArtifactHandoffContract;
export declare function validateTeamArtifactHandoff(input: {
    roleContracts: readonly TeamRoleArtifactContract[];
    producedArtifacts?: readonly string[];
}): TeamArtifactHandoffFinding[];
export declare function buildTeamRetryBudgetContract(input: {
    maxReworkCycles?: unknown;
    maxValidatorReruns?: unknown;
    maxReviewerReturns?: unknown;
    usedReworkCycles?: unknown;
    usedValidatorReruns?: unknown;
    usedReviewerReturns?: unknown;
    escalationTarget?: unknown;
}): TeamRetryBudgetContract;
export declare function buildTeamReworkRouteStateMachine(input: {
    findings?: readonly TeamReworkFinding[];
    requiredChecksPassed?: boolean;
    retryBudgetMax?: number;
    retryBudgetUsed?: number;
    previousStatus?: TeamReworkRouteStatus;
}): TeamReworkRoute;
export declare function transitionTeamReworkRoute(current: TeamReworkRoute, input: {
    findings?: readonly TeamReworkFinding[];
    requiredChecksPassed?: boolean;
    retryBudgetUsed?: number;
}): TeamReworkRoute;
export declare function validateTeamPermissionModel(recipe: TeamRecipe, writePaths: string[], options?: TeamPermissionValidationOptions): {
    ok: boolean;
    findings: PermissionFinding[];
};
export declare function planTeamBrokerLane(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    task: Record<string, unknown> | null | undefined;
    writePaths: string[];
}): {
    result: import("@ai-atomic-framework/core").TeamBrokerLaneResult;
    evidence: TeamBrokerLaneEvidence;
    findings: PermissionFinding[];
};
export declare function buildTeamPlan(input: {
    task: Record<string, unknown> | null | undefined;
    recipe: TeamRecipe;
    writePaths: string[];
    validation: {
        ok: boolean;
        findings: PermissionFinding[];
    };
    brokerLane: TeamBrokerLaneEvidence;
    allowEmptyWriteScope?: boolean;
    knowledgeSummary?: TeamKnowledgeSummary;
}): {
    requiredRoles: TeamCrewRole[];
    optionalRoles: TeamCrewRole[];
    briefingContract: {
        parallelAdvisory?: {
            schemaId: string;
            verdict: string;
            reasons: string[];
            conflicts: PermissionFinding[];
        } | undefined;
        schemaId: string;
        taskId: string;
        taskTitle: string;
        allowedFiles: string[];
        doNotTouch: string[];
        expectedReports: string[];
        stopConditions: string[];
        requiredRoles: TeamCrewRole[];
        optionalRoles: TeamCrewRole[];
        validation: {
            ok: boolean;
            findings: PermissionFinding[];
        };
        brokerAdvisory: {
            schemaId: string;
            verdict: string;
            stewardId: string | null;
            composerPath: string | null;
            decision: import("@ai-atomic-framework/core").BrokerDecision;
            chosenLane?: undefined;
            blockedReasons?: undefined;
        } | {
            schemaId: string;
            verdict: "serial" | "parallel-safe" | "needs-physical-split" | "blocked-cid-conflict" | "blocked-shared-surface" | "blocked-active-lease";
            chosenLane: "blocked" | "direct-brokered" | "deterministic-composer" | "serial";
            decision: import("@ai-atomic-framework/core").BrokerDecision;
            stewardId?: undefined;
            composerPath?: undefined;
            blockedReasons?: undefined;
        } | {
            schemaId: string;
            verdict: "serial" | "parallel-safe" | "needs-physical-split" | "blocked-cid-conflict" | "blocked-shared-surface" | "blocked-active-lease";
            chosenLane: "blocked" | "direct-brokered" | "deterministic-composer" | "serial";
            blockedReasons: readonly string[];
            decision: import("@ai-atomic-framework/core").BrokerDecision;
            stewardId?: undefined;
            composerPath?: undefined;
        };
    };
    atomizationPlannerRole: {
        role: string;
        agentIds: string[];
        permissions: string[];
    };
    atomizationChecklist: {
        primaryAtom: string;
        relatedAtoms: string[];
        commandSurface: string[];
        largeScriptRisk: {
            level: string;
            threshold: number;
            reasons: string[];
        };
        mapUpdateNeed: boolean;
        splitRecommendation: string;
    };
    suggestedPermissionLeases: PermissionLease[];
    nextSteps: string[];
    validation: {
        ok: boolean;
        findings: PermissionFinding[];
    };
    knowledgeSummary?: TeamKnowledgeSummary | undefined;
    schemaId: string;
    recipeId: string;
    channelHint: string;
    brokerLane: TeamBrokerLaneEvidence;
    agents: TeamRecipeAgent[];
    captainDecision: {
        schemaId: string;
        captain: {
            role: string;
            agentId: string;
        };
        taskId: string;
        authorityChain: {
            broker: string;
            coordinator: string;
        };
        conflictRules: string[];
        teamSize: string;
        requiredRoles: string[];
        optionalRoles: string[];
        reason: string;
        confidence: string;
        implementerSelector: TeamImplementerSelector;
        stopConditions: string[];
        escalationRequired: boolean;
        escalationReason: string;
        needLieutenant: boolean;
        nextTeamShape: {
            schemaId: string;
            captain: {
                role: string;
                permissions: string[];
            };
            lieutenant: {
                role: string;
                recommended: boolean;
                permissions: string[];
                forbiddenPermissions: string[];
                coordinationFocus: string[];
            };
            teamSizeHint: string;
            coordinationBoundary: string;
            signals: {
                scopeCount: number;
                crossRepoScope: boolean;
                validatorCount: number;
                largeScriptRisk: boolean;
                closureSignals: boolean;
                validationOk: boolean;
                brokerVerdict: "serial" | "parallel-safe" | "needs-physical-split" | "blocked-cid-conflict" | "blocked-shared-surface" | "blocked-active-lease";
            };
            suggestedPermissions: {
                captain: string[];
                lieutenant: string[];
            };
        };
        decisionSurface: {
            validationOk: boolean;
            brokerVerdict: "serial" | "parallel-safe" | "needs-physical-split" | "blocked-cid-conflict" | "blocked-shared-surface" | "blocked-active-lease";
            largeScriptRisk: {
                level: string;
                threshold: number;
                reasons: string[];
            };
            mapUpdateNeed: boolean;
            escalationRequired: boolean;
            needLieutenant: boolean;
            authorityChain: string;
        };
    };
    implementerSelector: TeamImplementerSelector;
    roleSkillPacks: TeamRoleSkillPackContract;
    routingMatrix: TeamRoleRoutingMatrix;
    growthContract: TeamGrowthContract;
    runtimePilot: TeamRuntimePilot;
};
export declare function buildTeamRoleSkillPackContract(recipe: TeamRecipe): TeamRoleSkillPackContract;
export declare function buildTeamRoleRoutingMatrix(roleSkillPacks: TeamRoleSkillPackContract): TeamRoleRoutingMatrix;
export declare function buildTeamGrowthContract(): TeamGrowthContract;
export declare function buildTeamRuntimePilot(input: {
    roleSkillPacks: TeamRoleSkillPackContract;
    routingMatrix: TeamRoleRoutingMatrix;
    growthContract: TeamGrowthContract;
    validation: {
        ok: boolean;
        findings: PermissionFinding[];
    };
    brokerLane: TeamBrokerLaneEvidence;
}): TeamRuntimePilot;
export declare function selectTeamImplementer(task: Record<string, unknown> | null | undefined, recipe: TeamRecipe, writePaths: string[]): TeamImplementerSelector;
export declare function assessLieutenantEscalation(task: Record<string, unknown> | null | undefined, writePaths: string[], validation: {
    ok: boolean;
    findings: PermissionFinding[];
}, brokerLane: TeamBrokerLaneEvidence, atomizationChecklist: ReturnType<typeof buildAtomizationChecklist>): {
    escalationRequired: boolean;
    escalationReason: string;
    needLieutenant: boolean;
    nextTeamShape: {
        schemaId: string;
        captain: {
            role: string;
            permissions: string[];
        };
        lieutenant: {
            role: string;
            recommended: boolean;
            permissions: string[];
            forbiddenPermissions: string[];
            coordinationFocus: string[];
        };
        teamSizeHint: string;
        coordinationBoundary: string;
        signals: {
            scopeCount: number;
            crossRepoScope: boolean;
            validatorCount: number;
            largeScriptRisk: boolean;
            closureSignals: boolean;
            validationOk: boolean;
            brokerVerdict: "serial" | "parallel-safe" | "needs-physical-split" | "blocked-cid-conflict" | "blocked-shared-surface" | "blocked-active-lease";
        };
        suggestedPermissions: {
            captain: string[];
            lieutenant: string[];
        };
    };
};
export declare function buildMinimalTaskCrewBriefingContract(task: Record<string, unknown> | null | undefined, writePaths: string[], validation: {
    ok: boolean;
    findings: PermissionFinding[];
}, brokerLane: TeamBrokerLaneEvidence): {
    parallelAdvisory?: {
        schemaId: string;
        verdict: string;
        reasons: string[];
        conflicts: PermissionFinding[];
    } | undefined;
    schemaId: string;
    taskId: string;
    taskTitle: string;
    allowedFiles: string[];
    doNotTouch: string[];
    expectedReports: string[];
    stopConditions: string[];
    requiredRoles: TeamCrewRole[];
    optionalRoles: TeamCrewRole[];
    validation: {
        ok: boolean;
        findings: PermissionFinding[];
    };
    brokerAdvisory: {
        schemaId: string;
        verdict: string;
        stewardId: string | null;
        composerPath: string | null;
        decision: import("@ai-atomic-framework/core").BrokerDecision;
        chosenLane?: undefined;
        blockedReasons?: undefined;
    } | {
        schemaId: string;
        verdict: "serial" | "parallel-safe" | "needs-physical-split" | "blocked-cid-conflict" | "blocked-shared-surface" | "blocked-active-lease";
        chosenLane: "blocked" | "direct-brokered" | "deterministic-composer" | "serial";
        decision: import("@ai-atomic-framework/core").BrokerDecision;
        stewardId?: undefined;
        composerPath?: undefined;
        blockedReasons?: undefined;
    } | {
        schemaId: string;
        verdict: "serial" | "parallel-safe" | "needs-physical-split" | "blocked-cid-conflict" | "blocked-shared-surface" | "blocked-active-lease";
        chosenLane: "blocked" | "direct-brokered" | "deterministic-composer" | "serial";
        blockedReasons: readonly string[];
        decision: import("@ai-atomic-framework/core").BrokerDecision;
        stewardId?: undefined;
        composerPath?: undefined;
    };
};
export declare function buildAtomizationChecklist(task: Record<string, unknown> | null | undefined, writePaths: string[]): {
    primaryAtom: string;
    relatedAtoms: string[];
    commandSurface: string[];
    largeScriptRisk: {
        level: string;
        threshold: number;
        reasons: string[];
    };
    mapUpdateNeed: boolean;
    splitRecommendation: string;
};
export declare function writeTeamRun(input: {
    cwd: string;
    actorId: string;
    taskId: string;
    task: Record<string, unknown> | null | undefined;
    recipe: TeamRecipe;
    teamPlan: ReturnType<typeof buildTeamPlan>;
    validation: {
        ok: boolean;
        findings: PermissionFinding[];
    };
    runtimeContract: TeamRuntimeContract;
}): {
    schemaId: string;
    teamRunId: string;
    channel: string;
    taskId: string;
    batchId: null;
    actorId: string;
    recipeId: string;
    status: string;
    executionMode: string;
    executionSurface: "editor-subagent" | "agent-runtime" | "broker-governance";
    runtimeMode: TeamRuntimeMode;
    runtimeLanguage: string;
    runtimeAdapterId: string | null;
    providerId: string | null;
    sdkId: string | null;
    modelId: string | null;
    runtimeContract: TeamRuntimeContract;
    artifactHandoff: TeamArtifactHandoffContract;
    retryBudget: TeamRetryBudgetContract;
    brokerSubagent: TeamBrokerSubagentContract;
    agentsSpawned: boolean;
    runtimeWritten: boolean;
    task: {
        taskId: string;
        title: {};
        status: {} | null;
        targetRepo: {} | null;
        sourcePlanPath: {} | null;
    };
    roles: {
        agentId: string;
        role: string;
        profile: string | null;
        language: string | null;
        permissions: string[];
    }[];
    agents: TeamRecipeAgent[];
    leases: PermissionLease[];
    permissionLeases: PermissionLease[];
    validation: {
        ok: boolean;
        findings: PermissionFinding[];
    };
    brokerLane: TeamBrokerLaneEvidence;
    captainDecision: {
        schemaId: string;
        captain: {
            role: string;
            agentId: string;
        };
        taskId: string;
        authorityChain: {
            broker: string;
            coordinator: string;
        };
        conflictRules: string[];
        teamSize: string;
        requiredRoles: string[];
        optionalRoles: string[];
        reason: string;
        confidence: string;
        implementerSelector: TeamImplementerSelector;
        stopConditions: string[];
        escalationRequired: boolean;
        escalationReason: string;
        needLieutenant: boolean;
        nextTeamShape: {
            schemaId: string;
            captain: {
                role: string;
                permissions: string[];
            };
            lieutenant: {
                role: string;
                recommended: boolean;
                permissions: string[];
                forbiddenPermissions: string[];
                coordinationFocus: string[];
            };
            teamSizeHint: string;
            coordinationBoundary: string;
            signals: {
                scopeCount: number;
                crossRepoScope: boolean;
                validatorCount: number;
                largeScriptRisk: boolean;
                closureSignals: boolean;
                validationOk: boolean;
                brokerVerdict: "serial" | "parallel-safe" | "needs-physical-split" | "blocked-cid-conflict" | "blocked-shared-surface" | "blocked-active-lease";
            };
            suggestedPermissions: {
                captain: string[];
                lieutenant: string[];
            };
        };
        decisionSurface: {
            validationOk: boolean;
            brokerVerdict: "serial" | "parallel-safe" | "needs-physical-split" | "blocked-cid-conflict" | "blocked-shared-surface" | "blocked-active-lease";
            largeScriptRisk: {
                level: string;
                threshold: number;
                reasons: string[];
            };
            mapUpdateNeed: boolean;
            escalationRequired: boolean;
            needLieutenant: boolean;
            authorityChain: string;
        };
    };
    runtimePilot: TeamRuntimePilot;
    reworkRoute: TeamReworkRoute;
    agentReports: never[];
    patrolFindings: never[];
    evidenceCuratorSummary: null;
    teamSummary: {
        decision: string;
        implementationSummary: string;
        validators: string[];
        evidence: never[];
        brokerGovernance: {
            schemaId: string;
            brokerSubagentEnabled: boolean;
            brokerDecisionSurface: "brokerLane";
            brokerStewardId: "neutral-write-steward";
            brokerGoverns: ("steward-apply" | "write-intents" | "scope-conflicts" | "commit-lane")[];
            brokerEvidenceRequired: ("atm.brokerOperationRunRecordEnvelope.v1" | "atm.stewardApplyEvidence.v1" | "atm.teamBrokerLaneEvidence.v1")[];
            commitLaneSerializedBy: "branch-commit-queue";
            commitLaneOwnerRole: "coordinator";
            workerGitWrite: false;
            workerTaskLifecycle: false;
            workerSelfClose: false;
        };
        risk: string;
        closeReady: boolean;
    };
    createdAt: string;
    updatedAt: string;
};
export declare function buildTeamStatusResult(input: {
    cwd: string;
    requestedTeamRunId: string;
    compact: boolean;
}): import("./shared.ts").CommandResult;
export declare function buildTeamPatrolResult(input: {
    cwd: string;
    taskId: string;
    mode: TeamPatrolMode;
    requestedTeamRunId: string;
}): import("./shared.ts").CommandResult;
export declare function buildTeamPatrolReport(input: {
    cwd: string;
    taskId: string;
    mode: TeamPatrolMode;
    requestedTeamRunId: string;
}): {
    schemaId: string;
    action: string;
    readOnly: boolean;
    runtimeWritten: boolean;
    historyWritten: boolean;
    agentsSpawned: boolean;
    mutations: never[];
    taskId: string;
    runId: string;
    patrolTeam: string[];
    mode: TeamPatrolMode;
    severity: TeamPatrolFindingLevel;
    safeToProceed: boolean;
    findings: TeamPatrolFinding[];
    suggestedCommand: string;
    followUp: string[];
    task: {
        taskId: string;
        title: {};
        status: {} | null;
        targetRepo: {} | null;
        sourcePlanPath: {} | null;
    };
    inspected: {
        taskPath: string;
        evidencePath: string;
        closurePacketPath: string;
        teamRunId: any;
        teamRunPath: string | null;
        runtimeRoot: string;
        historyRoot: string;
    };
};
export {};

import { buildTeamPlan } from './plan-orchestration.ts';
import type { PermissionFinding, TeamRecipe, TeamRuntimeContract } from './types.ts';
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
    executionSurface: "agent-runtime" | "editor-subagent" | "broker-governance";
    runtimeMode: import("./types.ts").TeamRuntimeMode;
    runtimeLanguage: string;
    runtimeAdapterId: string | null;
    providerId: string | null;
    sdkId: string | null;
    modelId: string | null;
    runtimeContract: TeamRuntimeContract;
    artifactHandoff: import("./types.ts").TeamArtifactHandoffContract;
    retryBudget: import("./types.ts").TeamRetryBudgetContract;
    brokerSubagent: import("./types.ts").TeamBrokerSubagentContract;
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
    agents: import("./types.ts").TeamRecipeAgent[];
    leases: import("./types.ts").PermissionLease[];
    permissionLeases: import("./types.ts").PermissionLease[];
    validation: {
        ok: boolean;
        findings: PermissionFinding[];
    };
    governanceRuntime: import("./types.ts").TeamGovernanceRuntimeFields;
    decisionClass: "blocked" | "auto-execution" | "human-signoff-required" | "adr-required";
    decisionReason: string;
    requiresHumanSignoff: boolean;
    requiresAdr: boolean;
    violationStatus: "none" | "blocked" | "warning" | "broker-conflict-blocked" | "human-signoff-required" | "adr-required";
    escalationTarget: string | null;
    brokerLane: import("@ai-atomic-framework/core").TeamBrokerLaneEvidence;
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
        teamLevel: import("./types.ts").TeamLevel;
        teamLevelSource: string;
        teamSize: string;
        requiredRoles: string[];
        optionalRoles: string[];
        reason: string;
        confidence: string;
        implementerSelector: import("./types.ts").TeamImplementerSelector;
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
                brokerVerdict: "blocked-cid-conflict" | "parallel-safe" | "needs-physical-split" | "blocked-shared-surface" | "serial" | "blocked-active-lease";
            };
            suggestedPermissions: {
                captain: string[];
                lieutenant: string[];
            };
        };
        decisionSurface: {
            validationOk: boolean;
            brokerVerdict: "blocked-cid-conflict" | "parallel-safe" | "needs-physical-split" | "blocked-shared-surface" | "serial" | "blocked-active-lease";
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
    shadowSchedule: import("../scheduler.ts").TeamShadowSchedule;
    contributionComposition: import("../../team/composer.ts").TeamContributionCompositionResult;
    runtimeTierContract: {
        schemaId: string;
        tiers: readonly ["raw-api", "agent-sdk", "editor"];
        providerContractCompatibility: readonly ["RawChatAdapter", "AgentLoopAdapter", "EditorAgentAdapter"];
        roleTiers: {
            role: string;
            agentId: string;
            runtimeTier: "editor" | "raw-api" | "agent-sdk";
            rationale: string;
        }[];
    };
    runtimePilot: import("./types.ts").TeamRuntimePilot;
    reworkRoute: import("./types.ts").TeamReworkRoute;
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
            brokerEvidenceRequired: ("atm.stewardApplyEvidence.v1" | "atm.teamBrokerLaneEvidence.v1" | "atm.brokerOperationRunRecordEnvelope.v1")[];
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
}): import("../../shared.ts").CommandResult;
export declare function evaluateTeamRequiredCompletionGate(input: {
    cwd: string;
    taskId: string;
    taskDocument: Record<string, unknown>;
}): {
    ok: boolean;
    required: boolean;
    taskId: string;
    teamRun: null;
    requiredCommand: null;
} | {
    ok: boolean;
    required: boolean;
    taskId: string;
    teamRun: {
        teamRunId?: undefined;
        taskId?: undefined;
        recipeId?: undefined;
        actorId?: undefined;
        status?: undefined;
        roleCount?: undefined;
        leaseCount?: undefined;
        brokerSubagentEnabled?: undefined;
        brokerDecisionSurface?: undefined;
        brokerStewardId?: undefined;
        brokerGovernanceSummaryId?: undefined;
        runtimePilotMode?: undefined;
        runtimePilotRoles?: undefined;
        decisionClass?: undefined;
        decisionReason?: undefined;
        requiresHumanSignoff?: undefined;
        requiresAdr?: undefined;
        violationStatus?: undefined;
        escalationTarget?: undefined;
        brokerEvidenceRequired?: undefined;
        commitLaneSerializedBy?: undefined;
        commitLaneOwnerRole?: undefined;
        workerGitWrite?: undefined;
        workerTaskLifecycle?: undefined;
        workerSelfClose?: undefined;
        agentsSpawned?: undefined;
        completedAt?: undefined;
        completedBy?: undefined;
        abandonedAt?: undefined;
        abandonedBy?: undefined;
        lifecycleEventCount?: undefined;
        createdAt?: undefined;
        updatedAt?: undefined;
    } | {
        teamRunId: unknown;
        taskId: unknown;
        recipeId: unknown;
        actorId: unknown;
        status: unknown;
        roleCount: number;
        leaseCount: number;
        brokerSubagentEnabled: boolean;
        brokerDecisionSurface: {} | null;
        brokerStewardId: {} | null;
        brokerGovernanceSummaryId: {} | null;
        runtimePilotMode: {} | null;
        runtimePilotRoles: string[];
        decisionClass: {} | null;
        decisionReason: {} | null;
        requiresHumanSignoff: {};
        requiresAdr: {};
        violationStatus: {} | null;
        escalationTarget: {} | null;
        brokerEvidenceRequired: string[];
        commitLaneSerializedBy: {} | null;
        commitLaneOwnerRole: {} | null;
        workerGitWrite: boolean | null;
        workerTaskLifecycle: boolean | null;
        workerSelfClose: boolean | null;
        agentsSpawned: boolean;
        completedAt: {} | null;
        completedBy: {} | null;
        abandonedAt: {} | null;
        abandonedBy: {} | null;
        lifecycleEventCount: number;
        createdAt: {} | null;
        updatedAt: {} | null;
    } | null;
    requiredCommand: string;
};

import type { TeamBrokerLaneEvidence } from '../../../core/src/broker/team-lane.ts';
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
type TeamCrewRole = {
    role: string;
    agentId: string;
    required: boolean;
    permissions: string[];
    description: string;
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
    readonly 'team.permission-lease-validator': {
        readonly anchor: "packages/cli/src/commands/team.ts#validateTeamPermissionModel";
        readonly capability: "Deterministic permission lease validation before team runtime start.";
        readonly downstreamTasks: readonly ["TASK-TEAM-0012"];
    };
};
export declare function runTeam(argv: string[]): Promise<import("./shared.ts").CommandResult>;
export declare function validateTeamPermissionModel(recipe: TeamRecipe, writePaths: string[]): {
    ok: boolean;
    findings: PermissionFinding[];
};
export declare function planTeamBrokerLane(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    task: any;
    writePaths: string[];
}): {
    result: import("@ai-atomic-framework/core").TeamBrokerLaneResult;
    evidence: TeamBrokerLaneEvidence;
    findings: PermissionFinding[];
};
declare function buildTeamPlan(input: {
    task: any;
    recipe: TeamRecipe;
    writePaths: string[];
    validation: {
        ok: boolean;
        findings: PermissionFinding[];
    };
    brokerLane: TeamBrokerLaneEvidence;
}): {
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
};
export declare function selectTeamImplementer(task: any, recipe: TeamRecipe, writePaths: string[]): TeamImplementerSelector;
export declare function assessLieutenantEscalation(task: any, writePaths: string[], validation: {
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
export declare function buildMinimalTaskCrewBriefingContract(task: any, writePaths: string[], validation: {
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
export declare function buildAtomizationChecklist(task: any, writePaths: string[]): {
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
    task: any;
    recipe: TeamRecipe;
    teamPlan: ReturnType<typeof buildTeamPlan>;
    validation: {
        ok: boolean;
        findings: PermissionFinding[];
    };
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
    agentsSpawned: boolean;
    runtimeWritten: boolean;
    task: {
        taskId: string;
        title: any;
        status: any;
        targetRepo: any;
        sourcePlanPath: any;
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
    createdAt: string;
    updatedAt: string;
};
export declare function buildTeamStatusResult(input: {
    cwd: string;
    requestedTeamRunId: string;
    compact: boolean;
}): import("./shared.ts").CommandResult;
export {};

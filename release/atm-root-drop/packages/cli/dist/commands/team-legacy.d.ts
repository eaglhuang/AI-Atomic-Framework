import { type TeamClosureAttestationEvidence } from './evidence.ts';
import { type TeamKnowledgeSummary } from './team-knowledge.ts';
import { evaluateTeamBrokerLane, type TeamBrokerLaneEvidence } from '../../../core/src/broker/team-lane.ts';
import { type TeamProviderHttpExecutor } from '../../../core/src/team-runtime/provider-contract.ts';
import { type TeamProviderSelectionConfig } from '../../../core/src/team-runtime/provider-selection.ts';
import { runProviderOrchestration } from '../../../core/src/team-runtime/execution-orchestrator.ts';
import { type GitIndexOwnershipReport } from './git-index-ownership.ts';
import { type TeamGrowthContract, type TeamRoleGrowthObservabilityContract } from './team/growth-contract.ts';
import { type TeamRoleRoutingMatrix, type TeamRoleSkillPackContract, type TeamRoleSkillPackManifest } from './team/role-skill-packs.ts';
export { buildTeamGrowthContract, buildTeamRoleGrowthObservabilityContract, type TeamGrowthContract, type TeamRoleGrowthObservabilityContract } from './team/growth-contract.ts';
export { buildProviderNeutralRoleSkillPackManifest, buildTeamRoleRoutingMatrix, buildTeamRoleSkillPackContract, type TeamRoleRoutingMatrix, type TeamRoleSkillPackContract, type TeamRoleSkillPackManifest } from './team/role-skill-packs.ts';
export { buildAnthropicRuntimeBridgeSummary, buildEditorExecutionRuntimeBridgeSummary, buildGeminiDirectRuntimeBridgeSummary, buildMicrosoftFoundryRuntimeBridgeSummary, buildOpenAIFamilyRuntimeBridgeSummary } from './team/runtime-bridges.ts';
import { TEAM_ATOM_BOUNDARIES, type BatchTeamAdmissionDecision, type PermissionFinding, type PermissionLease, type ReviewerIdentity, type TeamArtifactHandoffContract, type TeamArtifactHandoffFinding, type TeamBrokerSubagentContract, type TeamClosureAttestationInput, type TeamCrewRole, type TeamGovernanceRuntimeFields, type TeamImplementerSelector, type TeamLevel, type TeamPatrolFinding, type TeamPatrolFindingLevel, type TeamPatrolMode, type TeamPermissionLeaseSummary, type TeamPermissionValidationOptions, type TeamRecipe, type TeamRecipeAgent, type TeamRecommendation, type TeamRecommendationChannel, type TeamRetryBudgetContract, type TeamReworkFinding, type TeamReworkRoute, type TeamReworkRouteStatus, type TeamRoleArtifactContract, type TeamRuntimeContract, type TeamRuntimeMode, type TeamRuntimePilot, type TeamVendorLocalSecretsSummary } from './team/legacy/types.ts';
export { TEAM_ATOM_BOUNDARIES };
export type { BatchTeamAdmissionDecision, PermissionLease, TeamPermissionLeaseSummary, TeamRecommendation, TeamRecommendationChannel };
export declare function evaluateBatchTeamAdmission(input: {
    readonly taskId: string;
    readonly batchId: string;
    readonly currentQueueHeadTaskId: string | null | undefined;
    readonly structuralParallelism: boolean;
    readonly costTelemetryLoaded?: boolean;
    readonly stopLossTriggered?: boolean;
}): BatchTeamAdmissionDecision;
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
export declare function buildBrokerConflictSharedVocabulary(brokerLane: TeamBrokerLaneEvidence): {
    decisionClass: string;
    decisionReason: string;
    violationStatus: string;
    statusCode: string;
} | null;
export declare function buildBrokerConflictUxProjection(input: {
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
}): {
    schemaId: string;
    playbookSlice: string;
    requiredResolutionArtifact: string;
    decisionClass: string;
    decisionReason: string;
    violationStatus: string;
    statusCode: string;
    primaryTaskId: string;
    conflictingTaskIds: string[];
    blockedTaskIds: string[];
    currentAllowedTaskId: string;
    sharedPaths: string[];
    overlappingAtomIds: string[];
    nextSafeResolutionCommand: string;
    captainGuidance: string[];
};
export declare function runTeamBrokerConflictResolve(argv: string[], defaultCwd: string): import("./shared.ts").CommandResult;
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
export declare function resolveTeamPlanActorId(input: {
    cwd: string;
    taskId: string;
    explicitActorId?: string;
    fallbackActorId?: string;
}): string;
export declare function readActiveTaskClaimActorId(cwd: string, taskId: string): string | null;
export declare function planTeamBrokerLane(input: {
    cwd: string;
    taskId: string;
    actorId: string;
    task: Record<string, unknown> | null | undefined;
    writePaths: string[];
    readOnly?: boolean;
}): {
    result: import("@ai-atomic-framework/core").TeamBrokerLaneResult;
    evidence: TeamBrokerLaneEvidence;
    findings: PermissionFinding[];
};
/**
 * TASK-TEAM-0083 (backlog ATM-BUG-2026-07-12-133) — when the Broker lane
 * blocks on a proposal-first admission, the plan response must tell the
 * operator exactly which proposal contract to author and how to feed it back,
 * instead of a dead-end `proposal-submitted` status. `team plan` and
 * `team start` both accept `--broker-proposal-file` with the same validation.
 */
export declare function buildProposalFirstParityFindings(input: {
    taskId: string;
    brokerLaneResult: ReturnType<typeof evaluateTeamBrokerLane>;
    advisoryOnly?: boolean;
}): PermissionFinding[];
export declare function buildTeamPlan(input: {
    cwd?: string;
    task: Record<string, unknown> | null | undefined;
    recipe: TeamRecipe;
    writePaths: string[];
    validation: {
        ok: boolean;
        findings: PermissionFinding[];
    };
    brokerLane: TeamBrokerLaneEvidence;
    gitIndexOwnership?: GitIndexOwnershipReport;
    allowEmptyWriteScope?: boolean;
    requestedTeamSize?: string;
    providerSelectionConfig?: TeamProviderSelectionConfig | null;
    providerSelectionSource?: {
        schemaId: 'atm.teamAgentsConfig.v1';
        path: string | null;
        loaded: boolean;
        cliOverrideCount: number;
    } | null;
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
    teamLevel: TeamLevel;
    rosterProjection: {
        schemaId: string;
        teamLevel: TeamLevel;
        teamSize: string;
        activeRoles: string[];
        syntheticRoles: string[];
        deferredRoles: string[];
        catalogReadyRosterDeferredRoles: string[];
        roleRules: {
            L1: string;
            L2: string;
            L3: string;
            L4: string;
            L5: string;
        };
    };
    governanceRuntime: TeamGovernanceRuntimeFields;
    decisionClass: "blocked" | "human-signoff-required" | "adr-required" | "auto-execution";
    decisionReason: string;
    requiresHumanSignoff: boolean;
    requiresAdr: boolean;
    violationStatus: "none" | "warning" | "blocked" | "broker-conflict-blocked" | "human-signoff-required" | "adr-required";
    escalationTarget: string | null;
    providerSelectionSource: {
        schemaId: "atm.teamAgentsConfig.v1";
        path: string | null;
        loaded: boolean;
        cliOverrideCount: number;
    } | null;
    brokerLane: TeamBrokerLaneEvidence;
    indexLane: {
        readonly schemaId: "atm.gitIndexLane.v1";
        readonly status: import("./git-index-ownership.ts").GitIndexLaneStatus;
        readonly ownerTaskId: string | null;
        readonly ownerActorId: string | null;
        readonly reason: string;
    };
    gitIndexOwnership: GitIndexOwnershipReport | null;
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
        teamLevel: TeamLevel;
        teamLevelSource: string;
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
    roleSkillPackManifest: TeamRoleSkillPackManifest;
    routingMatrix: TeamRoleRoutingMatrix;
    growthContract: TeamGrowthContract;
    observabilityContract: {
        readonly schemaId: "atm.teamAgentObservabilityContract.v1";
        readonly eventSchemaId: "atm.teamAgentObservabilityEvent.v1";
        readonly queryResultSchemaId: "atm.teamAgentObservabilityQueryResult.v1";
        readonly providerNeutral: true;
        readonly queryKeys: readonly ["taskId", "teamRunId", "providerId", "role", "artifactType", "eventType"];
        readonly eventTypes: readonly ["session.start", "step.execution", "tool.invocation", "artifact.output", "session.complete", "session.failure", "broker.conflict.blocked", "broker.conflict.resolution", "handoff.materialized", "handoff.consumed", "handoff.integrity-blocked", "handoff.archived"];
        readonly brokerConflictVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
        readonly redactionPolicy: {
            readonly rawSecretsLogged: false;
            readonly rawSecretsAllowed: false;
            readonly governanceEvidenceOnly: true;
        };
    };
    roleGrowthObservabilityContract: TeamRoleGrowthObservabilityContract;
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
    shadowSchedule: import("./team/scheduler.ts").TeamShadowSchedule;
    openAIFamilyRuntimeBridges: {
        schemaId: "atm.openAIFamilyRuntimeBridgeSummary.v1";
        milestone: "M9I";
        providerIds: readonly ["openai", "azure-openai"];
        sharedProviderInterface: "atm.teamProviderContract.v1";
        sharedArtifactType: "atm.teamProviderRunArtifact.v1";
        observabilityEventSchemaId: "atm.teamAgentObservabilityEvent.v1";
        coordinatorOwnedAuthority: true;
        brokerConflictVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
        bridges: readonly [ReturnType<typeof import("../../../core/src/team-runtime/providers/openai.ts").buildOpenAITeamProviderBridgeDescriptor>, ReturnType<typeof import("packages/core/src/team-runtime/providers/azure-openai.ts").buildAzureOpenAITeamProviderBridgeDescriptor>];
    };
    editorExecutionRuntimeBridges: {
        schemaId: "atm.editorExecutionRuntimeBridgeSummary.v1";
        milestone: "M9I";
        providerIds: readonly ["claude-code", "gemini"];
        sharedProviderInterface: "atm.teamProviderContract.v1";
        sharedArtifactType: "atm.teamProviderRunArtifact.v1";
        roleEnvelopeSchemaId: "atm.teamEditorSubagentRoleEnvelope.v1";
        observabilityEventSchemaId: "atm.teamAgentObservabilityEvent.v1";
        coordinatorOwnedAuthority: true;
        brokerConflictVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
        bridges: readonly [ReturnType<typeof import("packages/core/src/team-runtime/providers/claude-code.ts").buildClaudeCodeTeamProviderBridgeDescriptor>, ReturnType<typeof import("packages/core/src/team-runtime/providers/gemini.ts").buildGeminiTeamProviderBridgeDescriptor>];
    };
    microsoftFoundryRuntimeBridges: {
        schemaId: "atm.microsoftFoundryRuntimeBridgeSummary.v1";
        milestone: "M9I";
        providerIds: readonly ["microsoft-foundry"];
        sharedProviderInterface: "atm.teamProviderContract.v1";
        sharedArtifactType: "atm.teamProviderRunArtifact.v1";
        supportedSurfaces: readonly ["project-chat-inference", "agent-service"];
        observabilityEventSchemaId: "atm.teamAgentObservabilityEvent.v1";
        coordinatorOwnedAuthority: true;
        brokerConflictVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
        bridges: readonly [ReturnType<typeof import("packages/core/src/team-runtime/providers/microsoft-foundry.ts").buildMicrosoftFoundryTeamProviderBridgeDescriptor>];
    };
    anthropicRuntimeBridges: {
        schemaId: "atm.anthropicRuntimeBridgeSummary.v1";
        milestone: "M10X";
        providerIds: readonly ["anthropic"];
        sharedProviderInterface: "atm.teamProviderContract.v1";
        sharedArtifactType: "atm.teamProviderRunArtifact.v1";
        observabilityEventSchemaId: "atm.teamAgentObservabilityEvent.v1";
        coordinatorOwnedAuthority: true;
        brokerConflictVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
        bridges: readonly [ReturnType<typeof import("../../../core/src/team-runtime/providers/anthropic.ts").buildAnthropicTeamProviderBridgeDescriptor>];
    };
    runtimePilot: TeamRuntimePilot;
};
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
export declare function evaluateReviewerIndependence(input: {
    implementer: ReviewerIdentity;
    reviewer: ReviewerIdentity;
    policy: 'different-provider' | 'different-model-family' | 'different-certification';
}): {
    schemaId: string;
    ok: boolean;
    policy: "different-provider" | "different-model-family" | "different-certification";
    checks: {
        differentProvider: boolean;
        differentModelFamily: boolean;
        differentCertification: boolean;
    };
    reason: string;
};
export declare function buildReviewAgentSignature(input: {
    taskId: string;
    reviewer: ReviewerIdentity;
    implementer: ReviewerIdentity;
    reviewedDiffHash: string;
    policy: 'different-provider' | 'different-model-family' | 'different-certification';
    findings?: readonly string[];
}): {
    schemaId: string;
    taskId: string;
    signatureStatus: string;
    permission: string | null;
    reviewer: {
        providerId: string;
        modelId: string;
        modelCertificationId: string | null;
    };
    implementer: {
        providerId: string;
        modelId: string;
        modelCertificationId: string | null;
    };
    modelCertificationId: string | null;
    reviewerIndependencePolicy: "different-provider" | "different-model-family" | "different-certification";
    independence: {
        schemaId: string;
        ok: boolean;
        policy: "different-provider" | "different-model-family" | "different-certification";
        checks: {
            differentProvider: boolean;
            differentModelFamily: boolean;
            differentCertification: boolean;
        };
        reason: string;
    };
    reviewedDiffHash: string;
    findings: string[];
    earlyWarning: {
        category: string;
        finding: string;
    }[];
};
export declare function evaluateReviewQuorum(input: {
    signatures: readonly ReturnType<typeof buildReviewAgentSignature>[];
    requiredFormalSignatures: number;
}): {
    schemaId: string;
    ok: boolean;
    requiredFormalSignatures: number;
    formalSignatureCount: number;
    advisoryNoteCount: number;
    conflicts: string[];
    escalationTarget: string | null;
    reason: string;
};
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
    governanceRuntime: TeamGovernanceRuntimeFields;
    decisionClass: "blocked" | "human-signoff-required" | "adr-required" | "auto-execution";
    decisionReason: string;
    requiresHumanSignoff: boolean;
    requiresAdr: boolean;
    violationStatus: "none" | "warning" | "blocked" | "broker-conflict-blocked" | "human-signoff-required" | "adr-required";
    escalationTarget: string | null;
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
        teamLevel: TeamLevel;
        teamLevelSource: string;
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
    shadowSchedule: import("./team/scheduler.ts").TeamShadowSchedule;
    contributionComposition: import("./team/composer.ts").TeamContributionCompositionResult;
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
export declare function runTeamProviderExecution(input: {
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
}): Promise<{
    requested: boolean;
    blockedReason: string;
    results: DirectTeamProviderRoleResult[];
    localSecrets?: undefined;
} | {
    requested: boolean;
    blockedReason: null;
    localSecrets: TeamVendorLocalSecretsSummary;
    results: DirectTeamProviderRoleResult[];
}>;
export type DirectTeamRoleHandoffArtifact = {
    readonly role: string;
    readonly providerId: string;
    readonly outputTextPreview: string;
};
export declare const TEAM_HANDOFF_CONTEXT_PER_ARTIFACT_TOKENS = 256;
export declare const TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS = 4;
export declare const TEAM_HANDOFF_CONTEXT_TOTAL_TOKENS = 1024;
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
export declare function buildDirectTeamRoleInstructions(input: {
    taskId: string;
    role: string;
    priorRoleArtifacts?: readonly DirectTeamRoleHandoffArtifact[];
}): {
    instructions: string;
    telemetry: DirectTeamProviderRoleResult['contextTelemetry'];
};
export declare function runDirectTeamProviderRole(input: {
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
}): Promise<DirectTeamProviderRoleResult | null>;
export declare function loadTeamVendorLocalSecrets(cwd: string): {
    env: Record<string, string | undefined>;
    summary: TeamVendorLocalSecretsSummary;
};
export declare function buildTeamStatusResult(input: {
    cwd: string;
    requestedTeamRunId: string;
    compact: boolean;
}): import("./shared.ts").CommandResult;
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
export declare function summarizeTeamPermissionLeases(input: {
    readonly teamRunId: string;
    readonly permission: string;
    readonly leases: readonly PermissionLease[];
}): TeamPermissionLeaseSummary[];
export declare function buildTeamLeaseConflictDetails(input: {
    readonly teamRunId: string;
    readonly permission: string;
    readonly requestedOwner: string;
    readonly conflict: PermissionLease;
    readonly currentLeases: readonly PermissionLease[];
}): {
    teamRunId: string;
    permission: string;
    currentOwner: string;
    currentOwnerPaths: string[];
    currentOwnerReleaseCommand: string;
    requestedOwner: string;
    activeLeases: TeamPermissionLeaseSummary[];
    requiredCommand: string;
};
export declare function buildTeamLeaseNotFoundDetails(input: {
    readonly teamRunId: string;
    readonly permission: string;
    readonly actorId: string;
    readonly currentLeases: readonly PermissionLease[];
}): {
    teamRunId: string;
    permission: string;
    actorId: string;
    activeLeases: TeamPermissionLeaseSummary[];
    holderCount: number;
    requiredCommand: string;
};

import { type TeamBrokerLaneEvidence } from '../../../../../core/src/broker/team-lane.ts';
import type { TeamProviderSelectionConfig } from '../../../../../core/src/team-runtime/provider-selection.ts';
import type { GitIndexOwnershipReport } from '../../git-index-ownership.ts';
import type { TeamKnowledgeSummary } from '../../team-knowledge.ts';
import { type TeamGrowthContract } from '../growth-contract.ts';
import { type TeamRoleRoutingMatrix, type TeamRoleSkillPackContract } from '../role-skill-packs.ts';
import { buildCaptainDecision } from './crew-decision-policy.ts';
import type { PermissionFinding, TeamGovernanceRuntimeFields, TeamRecipe, TeamRuntimePilot } from './types.ts';
export declare function resolveTeamPlanActorId(input: {
    cwd: string;
    taskId: string;
    requestedActorId?: string | null;
    explicitActorId?: string | null;
    fallbackActorId?: string | null;
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
    requiredRoles: import("./types.ts").TeamCrewRole[];
    optionalRoles: import("./types.ts").TeamCrewRole[];
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
        requiredRoles: import("./types.ts").TeamCrewRole[];
        optionalRoles: import("./types.ts").TeamCrewRole[];
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
            verdict: "blocked-cid-conflict" | "parallel-safe" | "needs-physical-split" | "blocked-shared-surface" | "serial" | "blocked-active-lease";
            chosenLane: "blocked" | "serial" | "direct-brokered" | "deterministic-composer";
            decision: import("@ai-atomic-framework/core").BrokerDecision;
            stewardId?: undefined;
            composerPath?: undefined;
            blockedReasons?: undefined;
        } | {
            schemaId: string;
            verdict: "blocked-cid-conflict" | "parallel-safe" | "needs-physical-split" | "blocked-shared-surface" | "serial" | "blocked-active-lease";
            chosenLane: "blocked" | "serial" | "direct-brokered" | "deterministic-composer";
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
    suggestedPermissionLeases: import("./types.ts").PermissionLease[];
    nextSteps: string[];
    validation: {
        ok: boolean;
        findings: PermissionFinding[];
    };
    knowledgeSummary?: TeamKnowledgeSummary | undefined;
    schemaId: string;
    recipeId: string;
    channelHint: string;
    teamLevel: import("./types.ts").TeamLevel;
    rosterProjection: {
        schemaId: string;
        teamLevel: import("./types.ts").TeamLevel;
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
    decisionClass: "blocked" | "auto-execution" | "human-signoff-required" | "adr-required";
    decisionReason: string;
    requiresHumanSignoff: boolean;
    requiresAdr: boolean;
    violationStatus: "warning" | "none" | "blocked" | "broker-conflict-blocked" | "human-signoff-required" | "adr-required";
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
        readonly status: import("../../git-index-ownership.ts").GitIndexLaneStatus;
        readonly ownerTaskId: string | null;
        readonly ownerActorId: string | null;
        readonly ownerSessionId: string | null;
        readonly reason: string;
    } | {
        schemaId: "atm.gitIndexLane.v1";
        status: "free";
        ownerTaskId: null;
        ownerActorId: null;
        reason: string;
    };
    gitIndexOwnership: GitIndexOwnershipReport | null;
    agents: import("./types.ts").TeamRecipeAgent[];
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
    implementerSelector: import("./types.ts").TeamImplementerSelector;
    roleSkillPacks: TeamRoleSkillPackContract;
    roleSkillPackManifest: import("../role-skill-packs.ts").TeamRoleSkillPackManifest;
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
    roleGrowthObservabilityContract: import("../growth-contract.ts").TeamRoleGrowthObservabilityContract;
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
    shadowSchedule: import("../scheduler.ts").TeamShadowSchedule;
    openAIFamilyRuntimeBridges: {
        schemaId: "atm.openAIFamilyRuntimeBridgeSummary.v1";
        milestone: "M9I";
        providerIds: readonly ["openai", "azure-openai"];
        sharedProviderInterface: "atm.teamProviderContract.v1";
        sharedArtifactType: "atm.teamProviderRunArtifact.v1";
        observabilityEventSchemaId: "atm.teamAgentObservabilityEvent.v1";
        coordinatorOwnedAuthority: true;
        brokerConflictVocabulary: readonly ["decisionClass", "decisionReason", "violationStatus", "broker-conflict-blocked"];
        bridges: readonly [ReturnType<typeof import("packages/core/src/team-runtime/providers/openai.ts").buildOpenAITeamProviderBridgeDescriptor>, ReturnType<typeof import("packages/core/src/team-runtime/providers/azure-openai.ts").buildAzureOpenAITeamProviderBridgeDescriptor>];
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
        bridges: readonly [ReturnType<typeof import("packages/core/src/team-runtime/providers/anthropic.ts").buildAnthropicTeamProviderBridgeDescriptor>];
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
export declare function buildTeamGovernanceRuntimeFields(input: {
    validation: {
        ok: boolean;
        findings: PermissionFinding[];
    };
    brokerLane: TeamBrokerLaneEvidence;
    runtimePilot: TeamRuntimePilot;
    captainDecision: ReturnType<typeof buildCaptainDecision>;
}): TeamGovernanceRuntimeFields;

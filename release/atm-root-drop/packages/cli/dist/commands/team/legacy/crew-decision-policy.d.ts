import type { TeamBrokerLaneEvidence } from '../../../../../core/src/broker/team-lane.ts';
import { type PermissionFinding, type TeamCrewRole, type TeamImplementerSelector, type TeamLevel } from './types.ts';
export declare function buildCaptainDecision(task: Record<string, unknown> | null | undefined, writePaths: string[], validation: {
    ok: boolean;
    findings: PermissionFinding[];
}, brokerLane: TeamBrokerLaneEvidence, crewBriefingContract: ReturnType<typeof buildMinimalTaskCrewBriefingContract>, atomizationChecklist: ReturnType<typeof buildAtomizationChecklist>, implementerSelector: TeamImplementerSelector, requestedTeamSize?: string): {
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
export declare function normalizeTeamSizeOverride(value: unknown): {
    teamLevel: TeamLevel;
    teamSize: 'small' | 'medium' | 'large';
} | null;
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
            brokerVerdict: "blocked-cid-conflict" | "parallel-safe" | "needs-physical-split" | "blocked-shared-surface" | "serial" | "blocked-active-lease";
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
export declare function evaluateLargeScriptRisk(writePaths: string[]): {
    level: string;
    threshold: number;
    reasons: string[];
};

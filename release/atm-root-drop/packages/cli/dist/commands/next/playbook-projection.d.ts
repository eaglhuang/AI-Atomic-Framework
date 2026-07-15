import { buildTeamRecommendation } from '../team.ts';
import { inspectIntegrationBootstrap } from '../integration.ts';
import { inspectRuntimeAdapterReadiness } from '../runtime-adapter-readiness.ts';
import { type ImportedTaskQueue, type ImportedTaskSummary } from './route-predicates.ts';
import { message } from '../shared.ts';
export declare function enrichWithLegacyPlan(cwd: string, base: GuidanceNextAction, plan: LegacyRoutePlan, sessionId: string): GuidanceNextAction;
export declare function buildAgentPackHint(status: string, command?: string | null, reason?: string | null): {
    slashCommandId: string;
    route: string;
    command: string;
    reason: string;
};
export declare function buildTaskDeliveryPrinciple(input: {
    readonly channel: 'normal' | 'batch';
    readonly taskId?: string;
}): {
    schemaId: string;
    taskId: string | null;
    channel: "batch" | "normal";
    principle: string;
    instruction: string;
    doneMeans: string;
    notAllowedAsCompletion: string[];
    nextStep: string;
};
export declare function buildMirrorSyncNextAction(input: {
    readonly task: ImportedTaskSummary;
    readonly classification: TaskDeliveryClassification;
}): NextActionLike;
type BatchPlaybookState = 'queue-preview' | 'queue-head-active' | 'repair-required';
export declare function buildActiveTaskDivergenceResult(input: {
    readonly cwd: string;
    readonly taskIntent: TaskIntent | null;
    readonly importedTaskQueue: ImportedTaskQueue;
    readonly integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>;
    readonly runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>;
}): import("../shared.ts").CommandResult | null;
export interface ActiveWorkSummary {
    readonly schemaId: 'atm.activeWorkSummary.v1';
    readonly generatedAt: string;
    readonly activeClaimCount: number;
    readonly activeActors: readonly {
        readonly actorId: string;
        readonly taskIds: readonly string[];
        readonly fileCount: number;
    }[];
    readonly activeClaims: readonly {
        readonly taskId: string;
        readonly title: string;
        readonly actorId: string;
        readonly intent: string;
        readonly claimedAt: string | null;
        readonly heartbeatAt: string | null;
        readonly heartbeatAgeSeconds: number | null;
        readonly ttlSeconds: number | null;
        readonly leaseFresh: boolean | null;
        readonly files: readonly string[];
    }[];
    readonly activeLocks: readonly {
        readonly workItemId: string;
        readonly actorId: string;
        readonly heartbeatAt: string | null;
        readonly heartbeatAgeSeconds: number | null;
        readonly ttlSeconds: number | null;
        readonly leaseFresh: boolean | null;
        readonly files: readonly string[];
    }[];
    readonly freshReservationCount: number;
    readonly freshReservations: readonly {
        readonly taskId: string;
        readonly title: string;
        readonly actorId: string;
        readonly createdAt: string | null;
        readonly importedAt: string | null;
        readonly ageSeconds: number;
        readonly ttlSeconds: number;
        readonly leaseFresh: boolean;
        readonly files: readonly string[];
    }[];
    readonly stagedFiles: readonly string[];
    readonly hasForeignActiveWork: boolean;
    readonly teamLevelRecommendation: {
        readonly level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
        readonly reason: string;
        readonly ownFiles: readonly string[];
        readonly overlappingFiles: readonly string[];
        readonly foreignActors: readonly string[];
    };
    readonly brokerRecommendation: {
        readonly enabled: boolean;
        readonly reason: string | null;
        readonly statusCommand: string;
        readonly brokerStatusCommand: string;
        readonly teamStatusCommand: string;
    };
}
export declare function buildActiveWorkSummary(cwd: string, currentActorId?: string | null, ownFiles?: readonly string[]): ActiveWorkSummary;
export declare function inspectFreshTaskReservationForTask(cwd: string, task: ImportedTaskSummary, currentActorId: string | null | undefined, now: number): ActiveWorkSummary['freshReservations'][number] | null;
export declare function normalizeWorkPath(value: string): string;
export declare function buildChannelPlaybook(input: {
    readonly channel: GovernanceChannel;
    readonly taskId?: string | null;
    readonly originalPrompt?: string | null;
    readonly queueHeadTaskId?: string | null;
    readonly actorPlaceholder?: string;
    readonly batchId?: string | null;
    readonly batchState?: BatchPlaybookState;
    readonly fastClaimCommand?: string | null;
    readonly fastClaimLabel?: string | null;
}): {
    schemaId: string;
    channel: string;
    title: string;
    mustFollow: boolean;
    summary: string;
    steps: string[];
    doNot: string[];
    commandSequence: string[];
    commitTiming: string;
    governedGitEntrypoint: {
        preferredCommand: string;
        directGitPolicy: string;
        fallbackFields?: undefined;
    };
    state?: undefined;
    checkpointCommand?: undefined;
    repairCommand?: undefined;
    closePreview?: undefined;
} | {
    schemaId: string;
    channel: string;
    title: string;
    mustFollow: boolean;
    summary: string;
    state: BatchPlaybookState;
    steps: string[];
    doNot: string[];
    commandSequence: string[];
    commitTiming: string;
    checkpointCommand: string;
    repairCommand: string;
    governedGitEntrypoint: {
        preferredCommand: string;
        directGitPolicy: string;
        fallbackFields?: undefined;
    };
    closePreview?: undefined;
} | {
    schemaId: string;
    channel: string;
    title: string;
    mustFollow: boolean;
    summary: string;
    steps: string[];
    doNot: string[];
    commandSequence: string[];
    closePreview: {
        schemaId: string;
        preCloseCommand: string;
        dryRunCommand: string;
        writeCommand: string;
        hintField: string;
    };
    commitTiming: string;
    governedGitEntrypoint: {
        preferredCommand: string;
        directGitPolicy: string;
        fallbackFields: string[];
    };
    state?: undefined;
    checkpointCommand?: undefined;
    repairCommand?: undefined;
};
export declare function embedTeamRecommendation<T extends {
    readonly playbook?: unknown;
}>(nextAction: T, input: Parameters<typeof buildTeamRecommendation>[0]): T & {
    teamRecommendation?: TeamRecommendation | null;
};
export declare function buildNextMessages(nextAction: NextActionLike, userNotice: AtmUserNotice | null, integrationBootstrap: ReturnType<typeof inspectIntegrationBootstrap>, runtimeAdapterReadiness: ReturnType<typeof inspectRuntimeAdapterReadiness>, routeMessage: ReturnType<typeof message>): import("../shared.ts").CommandMessage[];
export declare function buildGovernanceReadinessHint(cwd: string, input: {
    readonly channel: GovernanceChannel | null;
    readonly prompt: string;
    readonly taskId?: string | null;
    readonly actorId?: string | null;
    readonly ownFiles?: readonly string[];
    readonly frameworkClaimRequired?: boolean;
}): {
    schemaId: "atm.nextGovernanceReadinessHint.v1";
    channel: import("./governance-readiness.ts").GovernanceChannel | null;
    currentBranch: string | null;
    upstreamRef: string | null;
    protectedBranchTarget: boolean;
    aheadCount: number;
    frameworkClaimRequired: boolean;
    activeWorkSummary: unknown;
    earlyPreparation: string[];
    queueRetryCodes: readonly ["ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY", "ATM_GIT_COMMIT_BRANCH_QUEUE_RACE"];
    perCriticalCommitGitHeadEvidence: {
        enforcement: string;
        retainedStrictBoundaries: string[];
    };
    protectedPushHint: string | null;
};
export declare function shouldInspectCrossRepoFrameworkStatus(cwd: string, targetRepo: string | null): boolean;
export {};

import { type NextDecisionTrailEntry } from './match-and-sort.ts';
export type NextActionTeamRecommendationLike = {
    readonly schemaId: string;
    readonly enabled: boolean;
    readonly reason: string;
    readonly plan: string;
    readonly start: string;
    readonly status: string;
    readonly recipeId: string;
    readonly taskId: string | null;
    readonly knowledgeSummary?: unknown;
};
export type NextActionLike = {
    status: string;
    command?: string;
    reason?: string;
    recommendedChannel?: string | null;
    riskLevel?: string;
    selectedTask?: unknown;
    selectedTasks?: unknown;
    taskQueue?: unknown;
    queueHeadTaskId?: string | null;
    batchId?: string | null;
    taskDirectionLock?: {
        readonly taskId?: string;
        readonly schemaId?: string;
    };
    brokerQueueAdmission?: unknown;
    deliveryPrinciple?: unknown;
    playbook?: {
        readonly channel: string;
        readonly [key: string]: unknown;
    };
    teamRecommendation?: NextActionTeamRecommendationLike | null;
    allowedCommands?: readonly string[];
    blockedCommands?: readonly string[];
    missingEvidence?: readonly string[];
    requiredCommand?: string | null;
    closure?: {
        readonly taskId?: string;
        readonly status?: string;
        readonly closedAt?: string | null;
        readonly closedByActor?: string | null;
        readonly lastTransitionId?: string | null;
        readonly lastTransitionAt?: string | null;
        readonly closurePacketPath?: string | null;
    };
    planningStatusSync?: {
        readonly authority?: string;
        readonly instruction?: string;
    };
    claimIntent?: string | null;
    quickfixLock?: unknown;
    allowedFiles?: readonly string[];
    candidateCount?: number;
    candidates?: readonly unknown[];
    batchInstruction?: unknown;
    batchRun?: unknown;
    scopeKey?: string | null;
    sessionId?: string | null;
    actorSession?: unknown;
    scopeDiagnostic?: unknown;
    ignoredUntrackedFiles?: readonly string[];
    planningContext?: unknown;
    targetWork?: unknown;
    taskContext?: unknown;
    deliveryClassification?: unknown;
    mirrorSync?: unknown;
    decisionTrail?: NextDecisionTrailEntry[];
    playbookState?: 'present' | 'absent';
    structuredOutputHint?: {
        readonly schemaId: 'atm.nextStructuredOutputHint.v1';
        readonly hasPlaybook: boolean;
        readonly treatCliJsonAs: 'structured-tool-guidance';
        readonly followNextActionField: 'evidence.nextAction.command';
    };
    ignoredArtifactForceAddHints?: readonly {
        readonly path: string;
        readonly requiredCommand: string;
        readonly reason: string;
    }[];
    promptWorktreeHint?: {
        readonly schemaId: 'atm.promptWorktreeHint.v1';
        readonly promptPathHints: readonly string[];
        readonly promptMatchedFiles: readonly string[];
        readonly atmManagedFiles: readonly string[];
        readonly generatedArtifactFiles: readonly string[];
        readonly releaseMirrorFiles: readonly string[];
        readonly unrelatedTrackedFiles: readonly string[];
        readonly unrelatedUntrackedFiles: readonly string[];
        readonly ignoredArtifactCount: number;
        readonly note: string;
    };
    governanceReadiness?: {
        readonly schemaId: 'atm.nextGovernanceReadinessHint.v1';
        readonly channel: string | null;
        readonly currentBranch: string | null;
        readonly upstreamRef: string | null;
        readonly protectedBranchTarget: boolean;
        readonly aheadCount: number;
        readonly frameworkClaimRequired: boolean;
        readonly earlyPreparation: readonly string[];
        readonly queueRetryCodes: readonly string[];
        readonly perCriticalCommitGitHeadEvidence?: {
            readonly enforcement: string;
            readonly retainedStrictBoundaries: readonly string[];
        };
        readonly protectedPushHint: string | null;
    };
};
export declare function ensureDecisionTrail(nextAction: NextActionLike): NextActionLike;
export declare function buildDecisionTrail(nextAction: NextActionLike): NextDecisionTrailEntry[];
export declare function readTaskId(value: unknown): string | null;
export declare function readQueueHeadTaskId(value: unknown): string | null;

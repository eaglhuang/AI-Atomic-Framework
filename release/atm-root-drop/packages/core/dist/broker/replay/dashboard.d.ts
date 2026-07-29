export type ReplayDashboardReadiness = 'ready' | 'not-ready';
export type ReplayDashboardPredicateStatus = 'pass' | 'fail' | 'unknown';
export interface ReplayDashboardParticipant {
    readonly participantId: string;
    readonly provider?: string;
    readonly role?: string;
    readonly taskId?: string;
    readonly actorId: string;
    readonly processId: number | string | null;
    readonly laneSessionId?: string | null;
    readonly worktreeRoot: string;
    readonly baseDigest: string;
    readonly headDigest: string;
    readonly buildDigest: string;
    readonly runnerDigest: string;
    readonly selectedTaskIds?: readonly string[];
    readonly queuedTaskIds?: readonly string[];
    readonly ticketDigest?: string | null;
    readonly ticketGeneration?: string | number | null;
    readonly waitedMs?: number;
    readonly wakeup?: 'auto' | 'manual' | 'none';
    readonly authority?: {
        readonly lane?: string | null;
        readonly proxyActor?: string | null;
        readonly takeover?: boolean;
        readonly borrowedActor?: boolean;
    };
    readonly producerLabel?: string;
}
export interface ReplayDashboardValidatorSeal {
    readonly policyDigest: string;
    readonly unionDigest: string;
    readonly selectionInputDigest: string;
    readonly negativeControlRevealedAt: string | null;
    readonly currentUnionDigest?: string;
}
export interface ReplayDashboardLogicalIntent {
    readonly intentId: string;
    readonly physicalPath: string;
    readonly digest: string;
    readonly privateOutputDigest?: string | null;
    readonly proposalRoot?: string | null;
}
export interface ReplayDashboardRunManifestInput {
    readonly runId: string;
    readonly generatedAt?: string;
    readonly participants: readonly ReplayDashboardParticipant[];
    readonly sharedPhysicalFile: string;
    readonly logicalIntents: readonly ReplayDashboardLogicalIntent[];
    readonly validatorSeal: ReplayDashboardValidatorSeal;
    readonly thresholds: Readonly<Record<string, number | string | boolean>>;
    readonly timeWindow: {
        readonly startedAt: string;
        readonly endedAt: string | null;
    };
    readonly stopRule: string;
}
export interface ReplayDashboardRunManifest extends ReplayDashboardRunManifestInput {
    readonly schemaId: 'atm.replayRunManifest.v1';
    readonly specVersion: '0.1.0';
    readonly digest: string;
}
export interface ReplayDashboardInput extends ReplayDashboardRunManifestInput {
    readonly admissionFacadeDisposition: 'required' | 'not-required' | 'unknown';
    readonly adapterDecision?: string | null;
    readonly candidateOutputDigests?: readonly string[];
    readonly validatorRunDigests?: readonly string[];
    readonly commands?: readonly string[];
    readonly usageErrors?: readonly string[];
    readonly continuations?: readonly string[];
    readonly terminalPrunes?: readonly string[];
    readonly manualInterventions?: readonly string[];
    readonly falseStops?: readonly string[];
    readonly unavailableReceipts?: readonly string[];
    readonly cleanupRequired?: boolean;
    readonly manualRecoveryRequired?: boolean;
    readonly safeCompose?: boolean;
    readonly staleFallbackUsed?: boolean;
    readonly trueConflict?: boolean;
    readonly publication?: {
        readonly status: string;
        readonly sourceAvailable: boolean;
        readonly costRatio?: number;
        readonly throughputGainRatio?: number;
    };
    readonly receipts?: Readonly<Record<string, string | null>>;
    readonly admissionTrace?: readonly string[];
    readonly producerVerdictLabel?: string;
}
export interface ReplayDashboardPredicate {
    readonly id: string;
    readonly status: ReplayDashboardPredicateStatus;
    readonly reason: string;
}
export interface ReplayDashboardSnapshot {
    readonly schemaId: 'atm.replayDashboardSnapshot.v1';
    readonly manifest: ReplayDashboardRunManifest;
    readonly readiness: ReplayDashboardReadiness;
    readonly predicates: readonly ReplayDashboardPredicate[];
    readonly blockers: readonly string[];
    readonly observations: {
        readonly participantCount: number;
        readonly actorCount: number;
        readonly processCount: number;
        readonly worktreeRootCount: number;
        readonly baseDigestCount: number;
        readonly headDigestCount: number;
        readonly buildDigestCount: number;
        readonly runnerDigestCount: number;
        readonly sharedPhysicalFile: string;
        readonly logicalIntentCount: number;
        readonly logicalIntentDigestCount: number;
        readonly nonGitProposalRootCount: number;
        readonly commandCount: number;
        readonly usageErrorCount: number;
        readonly continuationCount: number;
        readonly terminalPruneCount: number;
        readonly manualInterventionCount: number;
        readonly falseStopCount: number;
        readonly unavailableReceiptCount: number;
        readonly candidateOutputDigestCount: number;
        readonly validatorRunDigestCount: number;
        readonly authorityLaneCount: number;
    };
    readonly decisions: {
        readonly adapterDecision: string | null;
        readonly safeCompose: boolean;
        readonly staleFallbackUsed: boolean;
        readonly trueConflict: boolean;
        readonly admissionFacadeDisposition: ReplayDashboardInput['admissionFacadeDisposition'];
        readonly publicationStatus: string | null;
        readonly sourceAvailable: boolean;
    };
    readonly digest: string;
}
export declare function createReplayRunManifest(input: ReplayDashboardRunManifestInput): ReplayDashboardRunManifest;
export declare function buildReplayDashboardSnapshot(input: ReplayDashboardInput): ReplayDashboardSnapshot;
export declare function renderReplayDashboardHuman(snapshot: ReplayDashboardSnapshot): string;

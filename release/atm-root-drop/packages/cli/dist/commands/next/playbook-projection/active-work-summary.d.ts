export interface ActiveWorkSummary {
    readonly schemaId: 'atm.activeWorkSummary.v1';
    readonly generatedAt: string;
    readonly activeClaimCount: number;
    readonly activeActors: readonly {
        readonly actorId: string;
        readonly taskIds: readonly string[];
        readonly fileCount: number;
        readonly sessionIds: readonly string[];
        readonly sessionCount: number;
        readonly editors: readonly string[];
    }[];
    readonly activeClaims: readonly {
        readonly taskId: string;
        readonly title: string;
        readonly actorId: string;
        readonly leaseId: string | null;
        readonly sessionId: string | null;
        readonly editor: string | null;
        readonly gitName: string | null;
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
        readonly laneSessionId: string | null;
        readonly createdAt: string | null;
        readonly importedAt: string | null;
        readonly ageSeconds: number;
        readonly ttlSeconds: number;
        readonly leaseFresh: boolean;
        readonly files: readonly string[];
    }[];
    readonly stagedFiles: readonly string[];
    readonly foreignDirtyFiles: readonly string[];
    readonly hasForeignActiveWork: boolean;
    readonly teamLevelRecommendation: {
        readonly level: 'L1' | 'L2' | 'L3' | 'L4' | 'L5';
        readonly reason: string;
        readonly ownFiles: readonly string[];
        readonly overlappingFiles: readonly string[];
        readonly foreignActors: readonly string[];
        readonly foreignSessions: readonly string[];
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
export declare function inspectFreshTaskReservationForTask(cwd: string, task: ImportedTaskSummary, currentActorId: string | null | undefined, now: number, currentLaneSessionId?: string | null | undefined): ActiveWorkSummary['freshReservations'][number] | null;
export declare function normalizeWorkPath(value: string): string;
export declare function mentionsNotCurrentTask(prompt: string): boolean;

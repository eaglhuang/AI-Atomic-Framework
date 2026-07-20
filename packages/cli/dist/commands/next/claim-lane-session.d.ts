export declare function buildClaimedMessage(input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly actorSource: string;
    readonly actorResolution: unknown;
    readonly recommendedChannel: string;
    readonly claimIntent: string;
    readonly ignoredUntrackedFiles: readonly string[];
}): import("../shared.ts").CommandMessage;
export declare function resolveCurrentLaneSessionIdForFreshReservation(cwd: string, actorId: string): string | null;
export declare function normalizeClaimLaneSessionEnvelope(value: Record<string, unknown> | null): {
    readonly laneSessionId: string;
    readonly status: string;
    readonly source: string;
    readonly exportHint: string;
} | null;

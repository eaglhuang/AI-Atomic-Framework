export interface LaneLifecycleOwner {
    readonly actorId?: string | null;
    readonly laneSessionId?: string | null;
}
export interface LaneLifecycleMismatch {
    readonly sameOwner: boolean;
    readonly mode: 'lane-id' | 'actor-fallback';
    readonly requiredCommand: string | null;
}
export declare function normalizeLaneScopePath(value: string): string;
export declare function normalizeLaneScopePaths(values: readonly string[]): readonly string[];
export declare function buildLaneLifecycleReconcileCommand(input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly reason: string;
}): string;
export declare function evaluateLaneLifecycleMismatch(input: {
    readonly current: LaneLifecycleOwner;
    readonly requested: LaneLifecycleOwner;
    readonly taskId: string;
    readonly actorId: string;
}): LaneLifecycleMismatch;

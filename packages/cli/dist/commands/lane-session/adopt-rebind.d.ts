import type { LaneSessionDocument } from './store.ts';
export interface LaneAdoptRebindResult {
    readonly reboundSessionIds: readonly string[];
    readonly reboundTaskIds: readonly string[];
    readonly preservedLeaseIds: readonly string[];
}
export declare function rebindLifecycleAfterLaneAdopt(input: {
    readonly cwd: string;
    readonly laneId: string;
    readonly actorId: string;
    readonly session: LaneSessionDocument;
    readonly timestamp?: string;
}): LaneAdoptRebindResult;

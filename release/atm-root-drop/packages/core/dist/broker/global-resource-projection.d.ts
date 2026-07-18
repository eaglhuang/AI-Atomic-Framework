import type { SharedSurfacesRecord } from './types.ts';
export declare const RUNNER_SYNC_STEWARD_GENERATOR = "atm.runner-sync.coalescing-steward";
export declare const RELEASE_MIRROR_ARTIFACT = "atm.release-mirror";
export declare const GIT_INDEX_REGISTRY = "atm.git-index-lane";
export declare const BRANCH_COMMIT_QUEUE_REGISTRY = "atm.branch-commit-queue";
export declare const GOVERNANCE_BACKLOG_PROJECTION = "atm.generated-projection.governance-backlog";
export declare const ATOM_MAP_PROJECTION = "atm.generated-projection.atom-map";
export declare const TEAM_VENDOR_HANDOFF_PROJECTION = "atm.generated-projection.team-vendor-handoff";
export interface GovernanceResourceProjectionOptions {
    readonly runnerSyncRequired?: boolean;
}
export declare function projectGovernanceSharedSurfacesFromPaths(paths: readonly string[], options?: GovernanceResourceProjectionOptions): SharedSurfacesRecord;
export declare function mergeSharedSurfaces(left: Partial<SharedSurfacesRecord> | null | undefined, right: Partial<SharedSurfacesRecord> | null | undefined): SharedSurfacesRecord;
export declare function emptyGovernanceSharedSurfaces(): SharedSurfacesRecord;

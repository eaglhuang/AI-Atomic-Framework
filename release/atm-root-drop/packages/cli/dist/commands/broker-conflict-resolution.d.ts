/**
 * Read foreign task ids authorized by a single broker conflict resolution
 * artifact for the given claiming task. Mirrors the governed commit lane.
 */
export declare function readResolutionAuthorizedForeignTaskIds(cwd: string, artifactPath: string | null, taskId: string): ReadonlySet<string>;
/**
 * Merge resolution authorization from an explicit artifact path and from
 * `.atm/runtime/broker-conflict-resolutions/*.json` sidecars.
 */
export declare function collectResolutionAuthorizedForeignTaskIds(cwd: string, taskId: string, explicitArtifactPath?: string | null): ReadonlySet<string>;
export declare function isConflictAuthorizedByBrokerResolution(conflictingTaskId: string | null | undefined, resolutionAuthorizedForeignTaskIds: ReadonlySet<string>): boolean;

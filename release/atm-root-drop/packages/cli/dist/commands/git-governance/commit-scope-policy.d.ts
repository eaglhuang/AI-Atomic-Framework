export type TaskClaimIntent = 'write' | 'closeout-only';
export declare function normalizeRelativePath(value: string): string;
export declare function uniqueSorted(values: readonly string[]): readonly string[];
export declare function pathMatchesTaskScope(filePath: string, scope: string): boolean;
export declare function extractGovernanceTaskIdFromPath(filePath: string): string | null;
export declare function isProtectedStagedGovernanceOwnershipPath(filePath: string): boolean;
export declare function normalizeTaskClaimIntent(value: unknown): TaskClaimIntent;

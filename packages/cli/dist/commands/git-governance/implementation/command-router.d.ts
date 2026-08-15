type LegacyValue = ReturnType<typeof JSON.parse>;
export declare function normalizeCommitLaneSessionId(value: LegacyValue): string | null;
export declare function laneSessionIdFromRecord(value: LegacyValue): string | null;
export declare function resolveCommitLaneSessionId(input?: LegacyValue): string | null;
export declare function runAtmGit(argv: LegacyValue): Promise<import("../../shared.ts").CommandResult>;
export {};

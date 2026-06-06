export type KnownBadSeverity = 'low' | 'medium' | 'high' | 'critical';
export interface KnownBadVersionEntry {
    versionRange: string;
    reason: string;
    replacementVersion: string;
    severity: KnownBadSeverity;
    addedAt: string;
}
export interface KnownBadVersionManifest {
    schemaVersion: 'atm.knownBadVersions.v0.1';
    entries: KnownBadVersionEntry[];
}
export type KnownBadMode = 'no-manifest' | 'ok' | 'known-bad' | 'parse-error' | 'invalid-range';
export interface KnownBadCheckResult {
    ok: boolean;
    mode: KnownBadMode;
    currentVersion: string;
    manifestPath: string | null;
    match: (KnownBadVersionEntry & {
        reasonSummary: string;
    }) | null;
}
export declare function resolveKnownBadManifestPath(): string | null;
export declare function resolveKnownBadRoot(): string;
export declare function readBundledCliVersion(): string;
export declare function checkStartupKnownBadVersion(): KnownBadCheckResult;
export declare function isKnownBadReadOnlyCommand(commandName: string, commandArgs: readonly string[]): boolean;
export declare function isSupportedKnownBadRange(range: string): boolean;
export declare function isSemverVersion(version: string): boolean;
export declare function matchesKnownBadRange(version: string, range: string): boolean;

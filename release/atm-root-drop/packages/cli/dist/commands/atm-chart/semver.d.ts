export interface ParsedSemver {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly prerelease: string;
}
export declare function parseSemver(version: string): ParsedSemver;
export declare function isSemver(version: string): boolean;
export declare function compareSemver(left: string, right: string): number;
/** Return the higher of two semver strings, treating null right as -∞. */
export declare function higherVersion(left: string, right: string | null): string;
/** Alias of higherVersion preserved for clarity in the cache-update code path. */
export declare function highestVersion(left: string, right: string | null): string;
/** Normalize an unknown value into a trimmed semver string or null. */
export declare function asOptionalVersion(value: unknown): string | null;

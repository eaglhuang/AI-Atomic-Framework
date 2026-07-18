export declare const legacyBehaviorPackageNames: string[];
export declare const knownTsNoCheckBaseline: Set<string>;
export interface TsNoCheckCleanupOwner {
    readonly ownerId: string;
    readonly title: string;
    readonly patterns: readonly string[];
    readonly followUp: string;
}
export declare const knownTsNoCheckCleanupOwners: readonly TsNoCheckCleanupOwner[];

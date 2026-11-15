export declare const charterUpgradePaths: readonly string[];
export type CharterUpgradeStatus = 'current' | 'outdated' | 'missing' | 'conflict';
export interface CharterUpgradeOptions {
    readonly cwd: string;
    readonly write: boolean;
    readonly enforceNow?: boolean;
    readonly frameworkVersion?: string | null;
    readonly now?: Date;
    readonly templateRoot?: string;
}
export interface CharterUpgradeReport {
    readonly status: CharterUpgradeStatus;
    readonly currentVersion: string | null;
    readonly bundledVersion: string;
    readonly addedInvariants: readonly string[];
    readonly updatedInvariants: readonly string[];
    readonly preservedAdopterInvariants: readonly string[];
    readonly scheduleAAdded: boolean;
    readonly advisoryUntilFrameworkVersion: string | null;
    readonly conflicts: readonly string[];
    readonly changedFiles: readonly string[];
    readonly written: boolean;
    readonly receiptPath: string | null;
}
export declare function compareCharterVersions(left: string | null, right: string | null): number;
export declare function nextPatchVersion(version: string | null | undefined): string | null;
export declare function readBundledCharterVersion(templateRoot?: string): string;
export declare function upgradeCharter(options: CharterUpgradeOptions): CharterUpgradeReport;

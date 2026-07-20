interface UpgradeScanOptions {
    cwd: string;
    inputPaths: string[];
    proposedBy?: string | null;
    proposedAt?: string | null;
    dryRun?: boolean;
}
export declare function runUpgradeScan(options: UpgradeScanOptions): Promise<import("../shared.ts").CommandResult>;
export {};

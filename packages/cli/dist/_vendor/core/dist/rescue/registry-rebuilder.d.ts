export interface RebuildRegistryResult {
    dryRun: boolean;
    backedUpTo: string | null;
    rebuiltEntries: number;
    orphanedCapsules: string[];
    missingCapsules: string[];
    skippedFiles: string[];
    errors: string[];
}
export interface RebuildMapsResult {
    dryRun: boolean;
    backedUpTo: string | null;
    rebuiltEntries: number;
    orphanedMaps: string[];
    merkleErrors: string[];
    errors: string[];
}
export declare function rebuildCapsuleRegistry(repositoryRoot: string, options?: {
    dryRun?: boolean;
    backupDir?: string;
}): RebuildRegistryResult;
export declare function rebuildMapRegistry(repositoryRoot: string, options?: {
    dryRun?: boolean;
    backupDir?: string;
}): RebuildMapsResult;

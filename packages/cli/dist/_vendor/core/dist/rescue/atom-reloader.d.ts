export interface ReloadAtomsResult {
    dryRun: boolean;
    backedUpTo: string | null;
    restoredFiles: Array<{
        atomId: string;
        filePath: string;
    }>;
    skippedCapsules: string[];
    errors: string[];
}
export declare function reloadAtomsFromCapsules(repositoryRoot: string, options?: {
    dryRun?: boolean;
    backupDir?: string;
}): ReloadAtomsResult;

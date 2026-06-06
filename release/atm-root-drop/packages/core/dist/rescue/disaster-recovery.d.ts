import { rebuildCapsuleRegistry, rebuildMapRegistry } from './registry-rebuilder.ts';
import { reloadAtomsFromCapsules } from './atom-reloader.ts';
import { replayLineageFromEvidence } from './lineage-replayer.ts';
export interface DiagnoseReport {
    schemaId: 'atm.rescueDiagnoseReport';
    checkedAt: string;
    repositoryRoot: string;
    healthScore: number;
    criticalFindings: Array<{
        invariantId: string;
        description: string;
        recoveryHint: string;
    }>;
    recommendedActions: string[];
    recoverableData: {
        atomsFromCapsule: number;
        mapsFromVendor: number;
        lineageMaps: string[];
    };
}
export interface ClearCacheResult {
    dryRun: boolean;
    clearedPaths: string[];
    errors: string[];
}
export interface FactoryResetResult {
    dryRun: boolean;
    backedUpTo: string;
    clearedPaths: string[];
    errors: string[];
}
export declare function diagnoseRecovery(repositoryRoot: string): DiagnoseReport;
export declare function clearCache(repositoryRoot: string, options?: {
    dryRun?: boolean;
}): ClearCacheResult;
export declare function factoryReset(repositoryRoot: string, options?: {
    dryRun?: boolean;
    confirm?: boolean;
    iUnderstandThisDeletesState?: boolean;
    backupDir?: string;
}): FactoryResetResult;
export { rebuildCapsuleRegistry, rebuildMapRegistry, reloadAtomsFromCapsules, replayLineageFromEvidence };

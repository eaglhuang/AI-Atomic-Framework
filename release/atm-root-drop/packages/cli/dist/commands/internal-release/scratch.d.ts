import type { InternalReleaseSyncOptions, ScratchGuardReport } from './types.ts';
export declare function cleanForbiddenAdopterScratch(repoPath: string, options: Pick<InternalReleaseSyncOptions, 'dryRun' | 'keepTemp'>): ScratchGuardReport;
export declare function createEmptyScratchGuard(options: Pick<InternalReleaseSyncOptions, 'dryRun' | 'keepTemp'>): ScratchGuardReport;

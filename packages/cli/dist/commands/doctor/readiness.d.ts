import type { DoctorCheck } from './types.ts';
export declare function createGovernanceEntryReadinessCheck(root: string, repoIdentity: {
    isFrameworkRepo: boolean;
}, gitHeadEvidenceCheck: DoctorCheck): DoctorCheck;
export declare function createBacklogSyncCheck(root: string, repoIdentity: {
    isFrameworkRepo: boolean;
}): DoctorCheck;
export declare function parseBacklogRows(markdown: string): {
    id: string;
    status: string;
    area: string;
    evidence: string;
    followUp: string;
}[];
export declare function runGitScalar(cwd: string, args: readonly string[]): string | null;
export declare function isProtectedFrameworkBranchTarget(branch: string): boolean;
export declare function hasRequiredScripts(scripts?: Record<string, string>): boolean;
export declare function isFrameworkContractExpected(repoIdentity: {
    isFrameworkRepo: boolean;
}): boolean;

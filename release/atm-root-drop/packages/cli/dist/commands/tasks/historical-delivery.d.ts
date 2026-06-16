import { type HistoricalDeliveryProvenance } from '../framework-development.ts';
export interface HistoricalDeliveryFileBuckets {
    readonly taskMatchedFiles: readonly string[];
    readonly governanceFiles: readonly string[];
    readonly allowedRunnerOutputFiles: readonly string[];
    readonly outOfScopeSourceFiles: readonly string[];
    readonly ignoredFiles: readonly string[];
}
export interface TaskHistoricalDeliveryReport {
    readonly requestedRef: string;
    readonly commitSha: string | null;
    readonly ok: boolean;
    readonly reason: string;
    readonly changedFiles: readonly string[];
    readonly deliverableFiles: readonly string[];
    readonly fileBuckets: HistoricalDeliveryFileBuckets;
    readonly waiverApplied: boolean;
}
export declare function categorizeHistoricalCommitFiles(input: {
    readonly taskId: string;
    readonly changedFiles: readonly string[];
    readonly declaredFiles: readonly string[];
}): HistoricalDeliveryFileBuckets;
export declare function inspectHistoricalDelivery(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly requestedRef: string;
    readonly declaredFiles: readonly string[];
    readonly enforceDeclaredScope: boolean;
    readonly waiverOutOfScopeDelivery: boolean;
    readonly waiverReason: string | null;
}): TaskHistoricalDeliveryReport;
export declare function buildHistoricalDeliveryProvenance(report: TaskHistoricalDeliveryReport | null, waiverReason: string | null | undefined): HistoricalDeliveryProvenance | null;
export declare function pathMatchesTaskScope(filePath: string, scope: string): boolean;
export declare function isDeliverableGateCandidate(filePath: string, declaredFiles: readonly string[]): boolean;

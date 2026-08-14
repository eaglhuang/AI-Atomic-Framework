import { type HistoricalDeliveryProvenance } from '../framework-development.ts';
export declare const DIRECTORY_DELIVERABLE_MANIFEST_SCHEMA_ID = "atm.directoryDeliverableManifest.v1";
export interface DirectoryDeliverableManifestEntry {
    readonly schemaId: typeof DIRECTORY_DELIVERABLE_MANIFEST_SCHEMA_ID;
    readonly declaredPath: string;
    readonly files: readonly string[];
    readonly missingFiles: readonly string[];
}
export interface DirectoryDeliverableExpansion {
    readonly ok: boolean;
    readonly failClosedReason: string | null;
    readonly effectiveDeliverables: readonly string[];
    readonly directoryManifests: readonly DirectoryDeliverableManifestEntry[];
    readonly expandedFiles: readonly string[];
}
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
export interface DetectedHistoricalDeliveryCommit {
    readonly ref: string | null;
    readonly commitSha: string | null;
    readonly source: 'planning-card' | 'git-log-trailer' | 'git-log-scope' | null;
}
export declare function readPlanningCardDeliveryCommit(repoRoot: string, relativePlanningPath: string): string | null;
export declare function detectHistoricalDeliveryCommit(input: {
    readonly cwd: string;
    readonly taskId: string;
    readonly declaredFiles: readonly string[];
    readonly planningRepoRoot?: string | null;
    readonly planningRelativePath?: string | null;
    readonly searchLimit?: number;
}): DetectedHistoricalDeliveryCommit;
export declare function buildHistoricalDeliveryProvenance(report: TaskHistoricalDeliveryReport | null, waiverReason: string | null | undefined): HistoricalDeliveryProvenance | null;
export declare function isDirectoryStyleDeliverableDeclaration(repoRoot: string, declaredPath: string): boolean;
export declare function listFilesUnderDeclaredDirectory(repoRoot: string, declaredPath: string): readonly string[];
export declare function expandDirectoryDeliverableDeclarations(repoRoot: string, deliverables: readonly string[]): DirectoryDeliverableExpansion;
export declare function pathMatchesTaskScope(filePath: string, scope: string): boolean;
export declare function isDeliverableGateCandidate(filePath: string, declaredFiles: readonly string[]): boolean;

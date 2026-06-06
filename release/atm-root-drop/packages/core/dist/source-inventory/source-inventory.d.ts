/**
 * Source inventory contract for Decomposition Police (APF-0031).
 *
 * Produces a read-only inventory of source surfaces with line counts,
 * language hints, entrypoints, and legacy URIs. Does not modify any
 * host project. 1000 LOC is the configurable default threshold.
 */
export declare const DEFAULT_MAX_FILE_LINES = 1000;
export interface SourceInventoryEntry {
    readonly filePath: string;
    readonly language?: string;
    readonly lineCount: number;
    readonly exportedSymbols?: readonly string[];
    readonly entrypointHint?: string;
    readonly legacyUri?: string;
    readonly ignoredReason?: string;
    readonly hasActiveReplacementMap?: boolean;
    readonly replacementMapId?: string;
}
export interface SourceInventoryReport {
    readonly schemaId: 'atm.sourceInventoryReport';
    readonly specVersion: '0.1.0';
    readonly generatedAt: string;
    readonly maxFileLines: number;
    readonly entries: readonly SourceInventoryEntry[];
    readonly ignoredPathPatterns: readonly string[];
}
export interface BuildSourceInventoryInput {
    readonly entries: readonly (Partial<SourceInventoryEntry> & {
        filePath: string;
        lineCount: number;
    })[];
    readonly maxFileLines?: number;
    readonly generatedAt?: string;
    readonly ignoredPathPatterns?: readonly string[];
}
export declare function buildSourceInventoryReport(input: BuildSourceInventoryInput): SourceInventoryReport;
export declare function isPathIgnored(filePath: string, ignoredPathPatterns: readonly string[]): boolean;
export declare function filterEligibleForDecomposition(report: SourceInventoryReport): readonly SourceInventoryEntry[];

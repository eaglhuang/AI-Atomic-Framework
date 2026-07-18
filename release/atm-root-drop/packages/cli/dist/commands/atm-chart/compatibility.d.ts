import type { ATMChartFrontmatter, CompatibilityMatrixBundle, CompatibilityMatrixDocument, FrameworkDowngradeReport, LegacyCompatibilityMatrixDocument, VersionCompatibilityReport, VersionLagStatus } from './types.ts';
export declare function loadCompatibilityMatrix(root?: string): CompatibilityMatrixDocument;
export declare function loadCompatibilityMatrixBundle(root?: string): CompatibilityMatrixBundle;
export declare function readFrameworkPackageVersion(root?: string): string;
export declare function createATMVersionSummary(cwd: string, outOption?: unknown): {
    frameworkVersion: string;
    chartVersion: string | null;
    templateVersion: string;
    defaultChartVersion: string;
    defaultTemplateVersion: string;
    releaseTrain: {
        readonly frameworkVersion: string;
        readonly defaultChartVersion: string;
        readonly defaultTemplateVersion: string;
        readonly minimumSupportedChartVersion?: string;
        readonly minimumSupportedTemplateVersion?: string;
    };
    compatibility: VersionCompatibilityReport;
    compatibilityMatrix: {
        source: "filesystem" | "bundled-snapshot";
        matrixPath: string | null;
        legacyMatrixPath: string | null;
        lastUpdated: string | null;
        legacyEntriesLoaded: number;
        warnings: readonly import("./types.ts").CompatibilityMatrixWarning[];
    };
    downgrade: FrameworkDowngradeReport;
    atmChartPath: string;
};
export declare function createVersionCompatibilityReport(input: {
    readonly frontmatter: Partial<ATMChartFrontmatter>;
    readonly matrix: CompatibilityMatrixDocument;
    readonly frameworkVersion: string;
}): VersionCompatibilityReport;
export declare function createVersionReport(matrix: CompatibilityMatrixDocument, frameworkVersion: string, chartVersion: string | null, templateVersion: string, status: VersionLagStatus, code: string, minFrameworkVersion: string | null, migrationGuide: string | null, reason: string): VersionCompatibilityReport;
export declare function normalizeCompatibilityMatrix(candidate: CompatibilityMatrixDocument): CompatibilityMatrixDocument;
export declare function loadLegacyCompatibilityMatrix(root?: string): {
    readonly document: LegacyCompatibilityMatrixDocument | null;
    readonly path: string | null;
    readonly entryCount: number;
};
export declare function normalizeLegacyCompatibilityMatrix(candidate: LegacyCompatibilityMatrixDocument): LegacyCompatibilityMatrixDocument;
export declare function mergeCompatibilityMatrices(activeMatrix: CompatibilityMatrixDocument, legacyMatrix: LegacyCompatibilityMatrixDocument | null): CompatibilityMatrixDocument;
export declare function mergeVersionEntries<T extends {
    readonly version: string;
}>(activeEntries: readonly T[], legacyEntries: readonly T[]): readonly T[];
export declare function detectFrameworkDowngrade(cwd: string, frameworkVersion: string): FrameworkDowngradeReport;
export declare function readVersionCache(cachePath: string): Record<string, unknown> | null;
export declare function writeVersionCache(cachePath: string, cache: Record<string, unknown>): void;
export declare function createDowngradeCompatibilityReport(report: VersionCompatibilityReport, downgrade: FrameworkDowngradeReport): VersionCompatibilityReport;
export declare function isFrameworkRepositoryRoot(cwd: string): boolean;
export declare function findChartRecord(matrix: CompatibilityMatrixDocument, version: string): import("./types.ts").CompatibilityMatrixChartVersion | null;

export { atmChartFrontmatterSchemaVersion, atmChartSourceSchemas, defaultATMChartRelativePath } from './atm-chart/constants.ts';
export type { ATMChartFrontmatter, ATMChartSourceSnapshot, ATMChartSummary, CompatibilityMatrixBundle, CompatibilityMatrixChartVersion, CompatibilityMatrixDocument, CompatibilityMatrixTemplateVersion, CompatibilityMatrixWarning, FrameworkDowngradeReport, LegacyCompatibilityMatrixChartVersion, LegacyCompatibilityMatrixDocument, LegacyCompatibilityMatrixTemplateVersion, VersionCompatibilityReport, VersionLagStatus } from './atm-chart/types.ts';
export { collectATMChartSources, collectSchemaDrift, createATMChartMarkdown, loadATMChartSummary, normalizePath, readATMChartFrontmatter, readDefaultGuards, resolveATMChartPath } from './atm-chart/render-verify.ts';
export { createATMVersionSummary, createVersionCompatibilityReport, loadCompatibilityMatrix, loadCompatibilityMatrixBundle, readFrameworkPackageVersion } from './atm-chart/compatibility.ts';
export { compareSemver } from './atm-chart/semver.ts';
export declare function runATMChart(argv: string[]): Promise<import("./shared.ts").CommandResult>;

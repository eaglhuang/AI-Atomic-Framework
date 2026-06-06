import type { DefaultGuardsDocument } from '../../../plugin-governance-local/src/default-guards.ts';
export declare const defaultATMChartRelativePath: string;
export declare const atmChartFrontmatterSchemaVersion: "atm.atmChart.v0.1";
export declare const atmChartSourceSchemas: Readonly<{
    'governance/default-guards': "schemas/governance/default-guards.schema.json";
    'charter/charter-invariants': "schemas/charter/charter-invariants.schema.json";
    'integrations/install-manifest': "schemas/integrations/install-manifest.schema.json";
    'agent-prompt': "schemas/agent-prompt.schema.json";
    'upgrade/upgrade-proposal': "schemas/upgrade/upgrade-proposal.schema.json";
}>;
type ATMChartFrontmatter = {
    readonly schema_version?: typeof atmChartFrontmatterSchemaVersion | string;
    readonly atm_chart_version?: string;
    readonly framework_version?: string;
    readonly template_version?: string;
    readonly min_framework_version?: string;
    readonly source_guards_path: string;
    readonly source_guards_sha256: string;
    readonly source_schema_sha256s: Record<string, string>;
};
export type VersionLagStatus = 'supported' | 'deprecated' | 'unsupported' | 'unknown';
export interface CompatibilityMatrixDocument {
    readonly schemaVersion: 'atm.compatibilityMatrix.v0.1';
    readonly lastUpdated?: string;
    readonly releaseTrain: {
        readonly frameworkVersion: string;
        readonly defaultChartVersion: string;
        readonly defaultTemplateVersion: string;
        readonly minimumSupportedChartVersion?: string;
        readonly minimumSupportedTemplateVersion?: string;
    };
    readonly atmChartVersions: readonly CompatibilityMatrixChartVersion[];
    readonly agentTemplateVersions: readonly CompatibilityMatrixTemplateVersion[];
}
export interface LegacyCompatibilityMatrixDocument {
    readonly schemaVersion: 'atm.compatibilityMatrixLegacy.v0.1';
    readonly lastUpdated: string;
    readonly atmChartVersions: readonly LegacyCompatibilityMatrixChartVersion[];
    readonly agentTemplateVersions: readonly LegacyCompatibilityMatrixTemplateVersion[];
}
export interface CompatibilityMatrixChartVersion {
    readonly version: string;
    readonly status: VersionLagStatus;
    readonly sourceSchemaVersion: string;
    readonly minFrameworkVersion: string;
    readonly maxFrameworkVersion?: string | null;
    readonly migrationGuide?: string | null;
}
export interface LegacyCompatibilityMatrixChartVersion extends CompatibilityMatrixChartVersion {
    readonly status: 'unsupported';
    readonly removedFromActiveSupportAt: string;
    readonly reason: string;
}
export interface CompatibilityMatrixTemplateVersion {
    readonly version: string;
    readonly status: VersionLagStatus;
    readonly minFrameworkVersion: string;
    readonly maxFrameworkVersion?: string | null;
    readonly migrationGuide?: string | null;
}
export interface LegacyCompatibilityMatrixTemplateVersion extends CompatibilityMatrixTemplateVersion {
    readonly status: 'unsupported';
    readonly removedFromActiveSupportAt: string;
    readonly reason: string;
}
export interface CompatibilityMatrixBundle {
    readonly matrix: CompatibilityMatrixDocument;
    readonly source: 'filesystem' | 'bundled-snapshot';
    readonly matrixPath: string | null;
    readonly legacyMatrixPath: string | null;
    readonly lastUpdated: string | null;
    readonly legacyEntriesLoaded: number;
    readonly warnings: readonly CompatibilityMatrixWarning[];
}
export interface CompatibilityMatrixWarning {
    readonly code: string;
    readonly text: string;
    readonly lastUpdated: string | null;
}
export interface FrameworkDowngradeReport {
    readonly checked: boolean;
    readonly detected: boolean;
    readonly cachePath: string;
    readonly currentFrameworkVersion: string;
    readonly lastSeenFrameworkVersion: string | null;
    readonly readOnlyDiagnostic: boolean;
    readonly reason: string | null;
}
export interface VersionCompatibilityReport {
    readonly ok: boolean;
    readonly status: VersionLagStatus;
    readonly code: string;
    readonly frameworkVersion: string;
    readonly chartVersion: string | null;
    readonly templateVersion: string;
    readonly defaultChartVersion: string;
    readonly defaultTemplateVersion: string;
    readonly minFrameworkVersion: string | null;
    readonly migrationGuide: string | null;
    readonly readOnlyDiagnostic: boolean;
    readonly reason: string;
    readonly compatibilityBaseCode?: string | null;
    readonly downgradeDetected?: boolean;
    readonly lastSeenFrameworkVersion?: string | null;
}
export interface ATMChartSourceSnapshot {
    readonly sourceGuardsPath: string;
    readonly sourceGuardsSha256: string;
    readonly sourceSchemaSha256s: Record<string, string>;
    readonly guardDocument: DefaultGuardsDocument;
}
export interface ATMChartSummary {
    readonly atmChartPath: string;
    readonly frontmatter: ATMChartFrontmatter;
    readonly body: string;
    readonly guardSummary: readonly string[];
}
export declare function runATMChart(argv: string[]): Promise<import("./shared.ts").CommandResult>;
export declare function collectATMChartSources(cwd: string): ATMChartSourceSnapshot;
export declare function collectSchemaDrift(recorded: Record<string, string>, current: Record<string, string>): ({
    schemaId: string;
    recorded: string;
    current: string;
} | {
    schemaId: string;
    recorded: string;
    current: null;
})[];
export declare function loadATMChartSummary(cwd: string, outOption?: unknown): ATMChartSummary;
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
        warnings: readonly CompatibilityMatrixWarning[];
    };
    downgrade: FrameworkDowngradeReport;
    atmChartPath: string;
};
export declare function createVersionCompatibilityReport(input: {
    readonly frontmatter: Partial<ATMChartFrontmatter>;
    readonly matrix: CompatibilityMatrixDocument;
    readonly frameworkVersion: string;
}): VersionCompatibilityReport;
export { compareSemver } from './atm-chart/semver.ts';

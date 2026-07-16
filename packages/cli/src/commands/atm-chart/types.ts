import type { DefaultGuardsDocument } from '../../../../plugin-governance-local/src/default-guards.ts';
import type { atmChartFrontmatterSchemaVersion } from './constants.ts';

export type ATMChartFrontmatter = {
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

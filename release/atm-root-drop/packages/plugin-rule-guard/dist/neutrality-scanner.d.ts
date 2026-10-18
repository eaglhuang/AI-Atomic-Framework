export declare const defaultNeutralityPolicyRelativePath = "docs/governance/docs-neutrality-policy.json";
export interface NeutralityScope {
    readonly path?: string;
    readonly pathPrefix?: string;
    readonly excludePrefixes?: readonly string[];
    readonly extensions?: readonly string[];
}
export interface NeutralityPolicy {
    readonly policyPath: string;
    readonly protectedFiles: readonly string[];
    readonly protectedScopes: readonly NeutralityScope[];
    readonly bannedTerms: readonly string[];
    readonly bannedPathPatterns: readonly string[];
    readonly ignoredPrefixes: readonly string[];
}
export interface NeutralityTarget {
    readonly fullPath: string;
    readonly relativePath: string;
}
export interface NeutralityViolation {
    readonly kind: 'term' | 'path';
    readonly file: string;
    readonly line?: number;
    readonly matchedRule: string;
}
export interface NeutralityReport {
    readonly schemaId: 'atm.neutralityReport';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none';
        readonly fromVersion: null;
        readonly notes: string;
    };
    readonly atomId: string;
    readonly legacyPlanningId: string;
    readonly repositoryRoot: string;
    readonly policyPath: string;
    readonly ok: boolean;
    readonly exitCode: number;
    readonly totals: {
        readonly scannedFiles: number;
        readonly termViolations: number;
        readonly pathViolations: number;
        readonly violations: number;
    };
    readonly scope: {
        readonly protectedFiles: readonly string[];
        readonly protectedScopes: readonly NeutralityScope[];
    };
    readonly violations: readonly NeutralityViolation[];
}
export interface ScanNeutralityTextResult {
    readonly ok: boolean;
    readonly relativePath: string;
    readonly violations: readonly NeutralityViolation[];
    readonly bannedTerms: readonly string[];
}
export interface NeutralityScannerOptions {
    readonly repositoryRoot?: string;
    readonly policyPath?: string;
    readonly policy?: NeutralityPolicy;
}
export declare function loadNeutralityPolicy(options?: NeutralityScannerOptions): NeutralityPolicy;
export declare function scanNeutralityRepository(options?: NeutralityScannerOptions): NeutralityReport;
export declare function formatGitHubAnnotations(report: NeutralityReport): string[];
export interface ScanNeutralityTextInput {
    readonly relativePath?: string;
    readonly content?: string;
}
export declare function scanNeutralityText(input: ScanNeutralityTextInput, options?: NeutralityScannerOptions): ScanNeutralityTextResult;

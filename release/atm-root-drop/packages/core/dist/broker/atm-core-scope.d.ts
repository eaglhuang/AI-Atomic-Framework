export interface RunnerBuildScopeManifest {
    readonly schemaId: 'atm.runnerBuildScope.v1';
    readonly specVersion: string;
    readonly policy: {
        readonly mode: string;
        readonly generatedArtifactWriter: string;
        readonly sourceAgentRule: string;
    };
    readonly runnerAffectingSourceRoots: readonly string[];
    readonly buildChainScripts: readonly string[];
    readonly buildConfigPaths: readonly string[];
    readonly rootLaunchers: readonly string[];
    readonly schemaRoots: readonly string[];
    readonly generatedArtifacts: readonly string[];
    readonly nonCorePlanningUtilities: readonly string[];
}
export type AtmCoreScopeKind = 'atm-core' | 'generated-artifact' | 'non-core-planning' | 'outside-atm-core';
export interface AtmCoreScopeClassification {
    readonly path: string;
    readonly kind: AtmCoreScopeKind;
    readonly matchedPattern: string | null;
    readonly stewardOnly: boolean;
}
export interface AtmCoreScopeDiagnostic {
    readonly code: 'ATM_CORE_SCOPE_UNDECLARED_WRITE' | 'ATM_CORE_SCOPE_RELEASE_WRITE_STEWARD_ONLY';
    readonly path: string;
    readonly message: string;
    readonly matchedPattern: string | null;
}
export interface AtmCoreScopeReport {
    readonly schemaId: 'atm.atmCoreScopeReport.v1';
    readonly classifications: readonly AtmCoreScopeClassification[];
    readonly diagnostics: readonly AtmCoreScopeDiagnostic[];
    readonly runnerSyncNeeded: boolean;
}
export declare function runnerAffectingPatterns(manifest: RunnerBuildScopeManifest): readonly string[];
export declare function classifyAtmCorePath(manifest: RunnerBuildScopeManifest, filePath: string): AtmCoreScopeClassification;
export declare function analyzeAtmCoreScope(manifest: RunnerBuildScopeManifest, filePaths: readonly string[]): AtmCoreScopeReport;

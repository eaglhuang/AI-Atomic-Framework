export type ModuleBoundaryEdgeKind = 'static-import' | 'dynamic-import' | 're-export';
export interface ModuleBoundaryModulePolicy {
    readonly id: string;
    readonly roots: readonly string[];
    readonly publicEntrypoints: readonly string[];
    readonly allowedConsumers: readonly string[];
    readonly allowedDependencies?: readonly string[];
    readonly adapterLanguages?: readonly string[];
}
export interface ModuleBoundaryException {
    readonly id: string;
    readonly fromModule: string;
    readonly toModule: string;
    readonly match?: string;
    readonly reason: string;
    readonly expiresOn: string;
}
export interface ModuleBoundarySourceDiscoveryPolicy {
    readonly adapterId: string;
    readonly language: string;
    readonly roots: readonly string[];
    readonly extensions: readonly string[];
}
export interface ModuleBoundaryPolicy {
    readonly schemaId: 'atm.moduleBoundaryPolicy.v1';
    readonly specVersion: '0.1.0';
    readonly migration?: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly generatedAt?: string;
    readonly mode: 'shadow' | 'enforce';
    readonly modules: readonly ModuleBoundaryModulePolicy[];
    readonly exceptions: readonly ModuleBoundaryException[];
    readonly sourceDiscovery: readonly ModuleBoundarySourceDiscoveryPolicy[];
}
export interface ModuleBoundaryDependencyEdge {
    readonly from: string;
    readonly to: string;
    readonly specifier: string;
    readonly kind: ModuleBoundaryEdgeKind;
    readonly adapterId: string;
}
export interface ModuleBoundaryDependencyGraph {
    readonly schemaId: 'atm.moduleBoundaryDependencyGraph.v1';
    readonly specVersion: '0.1.0';
    readonly adapterId: string;
    readonly language: string;
    readonly sourceRoot: string;
    readonly edges: readonly ModuleBoundaryDependencyEdge[];
}
export type ModuleBoundaryFindingCode = 'ATM_MODULE_BOUNDARY_DEEP_IMPORT' | 'ATM_MODULE_BOUNDARY_UNDECLARED_EDGE' | 'ATM_MODULE_BOUNDARY_CYCLE' | 'ATM_MODULE_BOUNDARY_EXPIRED_EXCEPTION' | 'ATM_MODULE_BOUNDARY_UNSUPPORTED_LANGUAGE';
export interface ModuleBoundaryFinding {
    readonly code: ModuleBoundaryFindingCode;
    readonly severity: 'error' | 'warning';
    readonly from?: string;
    readonly to?: string;
    readonly fromModule?: string;
    readonly toModule?: string;
    readonly specifier?: string;
    readonly exceptionId?: string;
    readonly cycle?: readonly string[];
    readonly message: string;
}
export interface ModuleBoundaryValidationReceipt {
    readonly schemaId: 'atm.moduleBoundaryValidationReceipt.v1';
    readonly specVersion: '0.1.0';
    readonly ok: boolean;
    readonly mode: 'shadow' | 'enforce';
    readonly generatedAt: string;
    readonly sourceDigest: string;
    readonly configDigest: string;
    readonly candidateDigest: string;
    readonly adapterId: string;
    readonly language: string;
    readonly unsupportedLanguage: boolean;
    readonly findings: readonly ModuleBoundaryFinding[];
    readonly observedEdgeCount: number;
}
export declare function evaluateModuleBoundaries(input: {
    readonly policy: ModuleBoundaryPolicy;
    readonly graph: ModuleBoundaryDependencyGraph;
    readonly generatedAt?: string;
    readonly today?: string;
    readonly sourceDigest?: string;
    readonly configDigest?: string;
    readonly candidateDigest?: string;
}): ModuleBoundaryValidationReceipt;
export declare function findOwningModule(modules: readonly ModuleBoundaryModulePolicy[], filePath: string): ModuleBoundaryModulePolicy | null;
export declare function normalizePath(value: string): string;

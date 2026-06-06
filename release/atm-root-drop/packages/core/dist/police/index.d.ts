export { buildDependencyGraph, detectCycles, validateDependencyGraph } from './dependency-graph.ts';
export { extractImportSources, validateForbiddenImports } from './forbidden-import-scanner.ts';
export { classifyImportLayer, validateLayerBoundary } from './layer-boundary.ts';
export { evaluatePromotionGate, validateRegistryConsistency } from './registry-consistency.ts';
export { createSchemaCheckResult, createSchemaValidator, validateJsonDocument, validateJsonFile } from './schema-validator.ts';
export declare function runPoliceChecks(options?: any): {
    schemaId: string;
    specVersion: string;
    lifecycleMode: any;
    ok: boolean;
    canPromote: boolean;
    checks: any[];
    violations: any[];
    artifacts: never[];
    evidence: never[];
};

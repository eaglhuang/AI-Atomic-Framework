import { validateDependencyGraph } from './dependency-graph.ts';
import { validateForbiddenImports } from './forbidden-import-scanner.ts';
import { validateLayerBoundary } from './layer-boundary.ts';
import { validateRegistryConsistency } from './registry-consistency.ts';
export { buildDependencyGraph, detectCycles, validateDependencyGraph } from './dependency-graph.ts';
export { extractImportSources, validateForbiddenImports } from './forbidden-import-scanner.ts';
export { classifyImportLayer, validateLayerBoundary } from './layer-boundary.ts';
export { evaluatePromotionGate, validateRegistryConsistency } from './registry-consistency.ts';
export { createSchemaCheckResult, createSchemaValidator, validateJsonDocument, validateJsonFile } from './schema-validator.ts';
interface PoliceChecksOptions {
    readonly lifecycleMode?: string;
    readonly mapFixture?: unknown;
    readonly layerPolicy?: unknown;
    readonly importGraph?: unknown[];
    readonly forbiddenPatterns?: unknown[];
    readonly registryGate?: Record<string, unknown>;
}
type PoliceCheckResult = ReturnType<typeof validateDependencyGraph> | ReturnType<typeof validateLayerBoundary> | ReturnType<typeof validateForbiddenImports> | ReturnType<typeof validateRegistryConsistency>;
export declare function runPoliceChecks(options?: PoliceChecksOptions): {
    schemaId: string;
    specVersion: string;
    lifecycleMode: string;
    ok: boolean;
    canPromote: boolean;
    checks: PoliceCheckResult[];
    violations: {
        code: string;
        severity: string;
        message: string;
    }[];
    artifacts: never[];
    evidence: never[];
};

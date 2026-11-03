import { validateDependencyGraph } from './dependency-graph.js';
import { validateForbiddenImports } from './forbidden-import-scanner.js';
import { validateLayerBoundary } from './layer-boundary.js';
import { validateRegistryConsistency } from './registry-consistency.js';
export { buildDependencyGraph, detectCycles, validateDependencyGraph } from './dependency-graph.js';
export { extractImportSources, validateForbiddenImports } from './forbidden-import-scanner.js';
export { classifyImportLayer, validateLayerBoundary } from './layer-boundary.js';
export { evaluatePromotionGate, validateRegistryConsistency } from './registry-consistency.js';
export { createSchemaCheckResult, createSchemaValidator, validateJsonDocument, validateJsonFile } from './schema-validator.js';
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

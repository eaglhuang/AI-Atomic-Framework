import { validateDependencyGraph } from './dependency-graph.js';
import { validateForbiddenImports } from './forbidden-import-scanner.js';
import { validateLayerBoundary } from './layer-boundary.js';
import { validateRegistryConsistency } from './registry-consistency.js';
export { buildDependencyGraph, detectCycles, validateDependencyGraph } from './dependency-graph.js';
export { extractImportSources, validateForbiddenImports } from './forbidden-import-scanner.js';
export { classifyImportLayer, validateLayerBoundary } from './layer-boundary.js';
export { evaluatePromotionGate, validateRegistryConsistency } from './registry-consistency.js';
export { createSchemaCheckResult, createSchemaValidator, validateJsonDocument, validateJsonFile } from './schema-validator.js';
export function runPoliceChecks(options = {}) {
    const lifecycleMode = options.lifecycleMode ?? 'birth';
    const checks = [];
    if (options.mapFixture) {
        checks.push(validateDependencyGraph(options.mapFixture));
    }
    if (options.layerPolicy && options.importGraph) {
        checks.push(validateLayerBoundary(options.importGraph, options.layerPolicy));
    }
    if (options.importGraph && options.forbiddenPatterns) {
        checks.push(validateForbiddenImports(options.importGraph, options.forbiddenPatterns));
    }
    if (options.registryGate) {
        checks.push(validateRegistryConsistency({ lifecycleMode, ...options.registryGate }));
    }
    const violations = checks.flatMap((check) => check.violations ?? []);
    const registryCheck = checks.find((check) => check.checkId === 'registry-consistency');
    const canPromote = lifecycleMode === 'evolution'
        ? registryCheck?.canPromote === true && violations.length === 0
        : violations.length === 0;
    return {
        schemaId: 'atm.policeReport',
        specVersion: '0.1.0',
        lifecycleMode,
        ok: violations.length === 0,
        canPromote,
        checks,
        violations,
        artifacts: [],
        evidence: []
    };
}

import { validateDependencyGraph } from './dependency-graph.mjs';
import { validateForbiddenImports } from './forbidden-import-scanner.mjs';
import { validateLayerBoundary } from './layer-boundary.mjs';
import { validateRegistryConsistency } from './registry-consistency.mjs';

export { buildDependencyGraph, detectCycles, validateDependencyGraph } from './dependency-graph.mjs';
export { extractImportSources, validateForbiddenImports } from './forbidden-import-scanner.mjs';
export { classifyImportLayer, validateLayerBoundary } from './layer-boundary.mjs';
export { evaluatePromotionGate, validateRegistryConsistency } from './registry-consistency.mjs';
export { createSchemaCheckResult, createSchemaValidator, validateJsonDocument, validateJsonFile } from './schema-validator.mjs';

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

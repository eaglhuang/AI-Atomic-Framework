import { normalizeImports } from './forbidden-import-scanner.mjs';

export function validateLayerBoundary(importGraph = [], policyDocument, options = {}) {
  const rules = new Map((policyDocument.rules ?? []).map((rule) => [rule.fromLayer, new Set(rule.allowedToLayers)]));
  const violations = [];
  for (const entry of importGraph) {
    const fromLayer = entry.fromLayer;
    const allowed = rules.get(fromLayer);
    if (!allowed) {
      violations.push({
        code: 'ATM_POLICE_LAYER_UNKNOWN',
        severity: 'error',
        message: `${entry.file ?? 'source'} uses unknown layer ${fromLayer}`,
        path: entry.file ?? ''
      });
      continue;
    }
    for (const imported of normalizeImports(entry.imports)) {
      const toLayer = imported.toLayer ?? classifyImportLayer(imported.source);
      if (toLayer === 'external' || toLayer === 'relative') {
        continue;
      }
      if (!allowed.has(toLayer)) {
        violations.push({
          code: 'ATM_POLICE_LAYER_BOUNDARY',
          severity: 'error',
          message: `${fromLayer} layer cannot import ${toLayer} layer (${imported.source})`,
          path: entry.file ?? ''
        });
      }
    }
  }
  return {
    checkId: options.checkId ?? 'layer-boundary',
    kind: 'layer-boundary',
    required: true,
    description: options.description ?? 'Validate imports follow layer boundary policy.',
    ok: violations.length === 0,
    violations
  };
}

export function classifyImportLayer(source) {
  const value = String(source ?? '');
  if (value.startsWith('.') || value.startsWith('/')) {
    return 'relative';
  }
  if (value.startsWith('node:') || !value.startsWith('@ai-atomic-framework/')) {
    return 'external';
  }
  if (value.startsWith('@ai-atomic-framework/core')) {
    return 'core';
  }
  if (value.startsWith('@ai-atomic-framework/plugin-')) {
    return 'plugin';
  }
  if (value.startsWith('@ai-atomic-framework/adapter-')) {
    return 'adapter';
  }
  if (value.includes('/effect')) {
    return 'effect';
  }
  return 'compute';
}

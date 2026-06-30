import { normalizeImports } from './forbidden-import-scanner.ts';

interface LayerBoundaryRuleRecord {
  readonly fromLayer?: string;
  readonly allowedToLayers?: unknown[];
}

interface LayerBoundaryPolicyDocument {
  readonly rules?: unknown[];
}

interface LayerBoundaryEntry {
  readonly file?: string;
  readonly fromLayer?: string;
  readonly imports?: unknown[];
}

interface LayerBoundaryOptions {
  readonly checkId?: string;
  readonly description?: string;
}

function asRuleRecord(value: unknown): LayerBoundaryRuleRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as LayerBoundaryRuleRecord
    : null;
}

function asLayerBoundaryEntry(value: unknown): LayerBoundaryEntry | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as LayerBoundaryEntry
    : null;
}

function asPolicyDocument(value: unknown): LayerBoundaryPolicyDocument | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as LayerBoundaryPolicyDocument
    : null;
}

export function validateLayerBoundary(importGraph: unknown[] = [], policyDocument: unknown, options: LayerBoundaryOptions = {}) {
  const policy = asPolicyDocument(policyDocument);
  const rules = new Map<string, Set<string>>(
    (policy?.rules ?? [])
      .map((rule) => asRuleRecord(rule))
      .filter((rule): rule is LayerBoundaryRuleRecord => typeof rule?.fromLayer === 'string')
      .map((rule) => [rule.fromLayer as string, new Set<string>((rule.allowedToLayers ?? []).filter((entry): entry is string => typeof entry === 'string'))])
  );
  const violations: Array<{ code: string; severity: string; message: string; path: string }> = [];
  for (const rawEntry of importGraph) {
    const entry = asLayerBoundaryEntry(rawEntry);
    if (!entry) {
      continue;
    }
    const fromLayer = entry.fromLayer;
    if (typeof fromLayer !== 'string' || fromLayer.length === 0) {
      violations.push({
        code: 'ATM_POLICE_LAYER_UNKNOWN',
        severity: 'error',
        message: `${entry.file ?? 'source'} uses unknown layer ${String(fromLayer ?? '')}`,
        path: entry.file ?? ''
      });
      continue;
    }
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

export function classifyImportLayer(source: unknown) {
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

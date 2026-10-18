import { normalizeImports } from './forbidden-import-scanner.js';
function asRuleRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function asLayerBoundaryEntry(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
function asPolicyDocument(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export function validateLayerBoundary(importGraph = [], policyDocument, options = {}) {
    const policy = asPolicyDocument(policyDocument);
    const rules = new Map((policy?.rules ?? [])
        .map((rule) => asRuleRecord(rule))
        .filter((rule) => typeof rule?.fromLayer === 'string')
        .map((rule) => [rule.fromLayer, new Set((rule.allowedToLayers ?? []).filter((entry) => typeof entry === 'string'))]));
    const violations = [];
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

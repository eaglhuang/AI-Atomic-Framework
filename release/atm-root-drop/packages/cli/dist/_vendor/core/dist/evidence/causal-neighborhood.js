import { createHash } from 'node:crypto';
export const CAUSAL_NEIGHBORHOOD_SCHEMA_ID = 'atm.causalNeighborhoodResult.v1';
const text = (v) => String(v ?? '').trim().toLowerCase();
const digest = (v) => `sha256:${createHash('sha256').update(JSON.stringify(v)).digest('hex')}`;
export function compileCausalNeighborhood(input) { const normalized = { ...input, runId: text(input?.runId), fingerprint: text(input?.fingerprint), publicSeam: text(input?.publicSeam), impactEdges: [...(input?.impactEdges ?? [])].map(text).sort(), validatorRefs: [...(input?.validatorRefs ?? [])].map(text).sort(), changedFiles: [...(input?.changedFiles ?? [])].map(text).sort(), factors: [...new Set((input?.factors ?? []).map(text).filter(Boolean))].sort(), maxCombinations: Math.max(0, Math.floor(input?.maxCombinations ?? 0)), excludedFactors: Object.fromEntries(Object.entries(input?.excludedFactors ?? {}).map(([key, value]) => [text(key), text(value)]).sort(([a], [b]) => a.localeCompare(b))) }; const diagnostics = []; if (!normalized.authority?.sealed || !normalized.authority?.digest)
    diagnostics.push({ code: 'ATM_CAUSAL_AUTHORITY_INVALID', message: 'Causal compilation requires sealed authority.', repairCommand: 'seal the causal authority before compilation' }); if (!normalized.fingerprint || !normalized.publicSeam)
    diagnostics.push({ code: 'ATM_CAUSAL_INPUT_INCOMPLETE', message: 'Fingerprint and public seam are required.', repairCommand: 'restore the sealed fingerprint and public seam' }); if (normalized.maxCombinations < 1)
    diagnostics.push({ code: 'ATM_CAUSAL_BOUND_INVALID', message: 'maxCombinations must be positive.', repairCommand: 'declare a positive combination bound' }); const neighborhood = [...new Set([normalized.fingerprint, normalized.publicSeam, ...normalized.impactEdges, ...normalized.validatorRefs, ...normalized.changedFiles].filter(Boolean))].sort(); const eligible = normalized.factors.filter((factor) => !normalized.excludedFactors[factor]); const combinations = []; for (const factor of eligible)
    for (const second of eligible)
        if (factor < second && combinations.length < normalized.maxCombinations)
            combinations.push([factor, second]); const inputDigest = digest(normalized); const status = diagnostics.some((item) => item.code.includes('AUTHORITY')) ? 'stale' : diagnostics.length ? 'blocked' : 'compiled'; return { schemaId: CAUSAL_NEIGHBORHOOD_SCHEMA_ID, specVersion: '0.1.0', runId: normalized.runId, resultId: `causal_neighborhood_${inputDigest.slice(7, 23)}`, status, authority: normalized.authority, neighborhood, combinations, exclusions: normalized.excludedFactors, diagnostics, provenance: { inputDigest, combinationCount: combinations.length } }; }
export const createCausalNeighborhood = compileCausalNeighborhood;
export const generateFactorCombinations = compileCausalNeighborhood;
export function replayCausalNeighborhood(input, expected) { const result = compileCausalNeighborhood(input); return { deterministic: JSON.stringify(result) === JSON.stringify(expected), result }; }
export function validateCausalNeighborhood(result) { const diagnostics = []; if (result.schemaId !== CAUSAL_NEIGHBORHOOD_SCHEMA_ID)
    diagnostics.push('schemaId'); if (!/^causal_neighborhood_[0-9a-f]{16}$/.test(result.resultId))
    diagnostics.push('resultId'); return { ok: diagnostics.length === 0, diagnostics }; }

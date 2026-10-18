import { createHash } from 'node:crypto';
export const ACCEPTANCE_SPEC_MUTATION_SCHEMA_ID = 'atm.acceptanceSpecMutation.v1';
export function compileAcceptanceSpecMutation(i) { const n = norm(i), d = []; if (!n.authority.specId || !n.authority.specDigest || !n.authority.sealed)
    d.push('authority-incomplete'); if (!n.mutationSetId || !n.sourceDigest || !n.mutations.length)
    d.push('mutation-set-incomplete'); if (n.sourceDigest !== n.authority.specDigest)
    d.push('source-authority-drift'); const seen = new Set(); for (const m of n.mutations) {
    if (seen.has(m.mutationId))
        d.push(`duplicate-mutation:${m.mutationId}`);
    seen.add(m.mutationId);
    if (!m.mutationId || !m.scenarioId)
        d.push(`invalid-mutation:${m.mutationId}`);
    if (!['negate', 'remove-step', 'swap-outcome'].includes(m.operator))
        d.push(`unsupported-operator:${m.mutationId}`);
    if (m.observed && m.observed !== m.expected)
        d.push(`verdict-mismatch:${m.mutationId}`);
} const survivors = n.mutations.filter(m => m.expected === 'survived' || m.observed === 'survived').map(m => m.mutationId); const status = d.some(x => x.startsWith('duplicate-') || x.startsWith('invalid-') || x === 'authority-incomplete' || x === 'mutation-set-incomplete') ? 'contradictory' : d.some(x => x === 'source-authority-drift') ? 'stale' : d.some(x => x.startsWith('unsupported-') || x.startsWith('verdict-')) ? 'blocked' : 'proven'; const repairCommand = status === 'proven' ? null : 'restore the sealed acceptance specification and rerun supported mutation operators'; return { schemaId: ACCEPTANCE_SPEC_MUTATION_SCHEMA_ID, specVersion: '0.1.0', mutationSetId: n.mutationSetId, authority: n.authority, mutations: n.mutations, survivingMutationIds: survivors, status, diagnostics: d, repairCommand, provenance: n.provenance, resultDigest: digest({ mutationSetId: n.mutationSetId, authority: n.authority, mutations: n.mutations, survivingMutationIds: survivors, status, diagnostics: d, repairCommand, provenance: n.provenance }) }; }
export const createAcceptanceSpecMutation = compileAcceptanceSpecMutation;
export function replayAcceptanceSpecMutation(r) { return compileAcceptanceSpecMutation({ authority: r.authority, mutationSetId: r.mutationSetId, mutations: r.mutations, sourceDigest: r.authority.specDigest, provenance: r.provenance }); }
export function validateAcceptanceSpecMutation(r) { const x = replayAcceptanceSpecMutation(r), d = [...r.diagnostics], actual = digest({ mutationSetId: r.mutationSetId, authority: r.authority, mutations: r.mutations, survivingMutationIds: r.survivingMutationIds, status: r.status, diagnostics: r.diagnostics, repairCommand: r.repairCommand, provenance: r.provenance }); if (actual !== r.resultDigest || x.resultDigest !== r.resultDigest)
    d.push('result-digest-mismatch'); return { ok: d.length === 0 && r.status === 'proven', diagnostics: [...new Set(d)] }; }
function norm(i) { return { authority: i.authority, mutationSetId: String(i.mutationSetId ?? '').trim(), sourceDigest: String(i.sourceDigest ?? '').trim(), mutations: [...(i.mutations ?? [])].map(m => ({ ...m, mutationId: String(m.mutationId ?? '').trim(), scenarioId: String(m.scenarioId ?? '').trim(), operator: String(m.operator ?? '').trim(), expected: m.expected, observed: m.observed })).sort((a, b) => a.mutationId.localeCompare(b.mutationId)), provenance: i.provenance ?? {} }; }
function digest(v) { return `sha256:${createHash('sha256').update(JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)).digest('hex')}`; }

import { createHash } from 'node:crypto';
export const EXAMPLE_BRANCH_GENERATORS_SCHEMA_ID = 'atm.exampleBranchGenerators.v1';
export function compileExampleBranchGenerators(input) { const n = normalize(input), d = []; if (!n.authority.authorityId || !n.authority.digest || n.authority.sealed !== true)
    d.push('authority-incomplete'); if (!n.generatorId || !n.sourceDigest || n.branches.length === 0)
    d.push('generator-incomplete'); if (n.sourceDigest !== n.authority.digest)
    d.push('source-authority-drift'); const seen = new Set(); for (const b of n.branches) {
    if (seen.has(b.branchId))
        d.push(`duplicate-branch:${b.branchId}`);
    seen.add(b.branchId);
    if (!b.branchId || !b.predicate)
        d.push(`invalid-branch:${b.branchId}`);
    if (b.outcome === 'unsupported')
        d.push(`unsupported-branch:${b.branchId}`);
    if (b.outcome === 'uncovered')
        d.push(`uncovered-branch:${b.branchId}`);
} const examples = n.branches.map(b => ({ exampleId: `example:${sha(`${n.generatorId}|${b.branchId}`)}`, branchId: b.branchId, predicate: b.predicate, outcome: b.outcome, survivorIds: b.survivorIds, digest: digest({ generatorId: n.generatorId, branchId: b.branchId, predicate: b.predicate, outcome: b.outcome, survivorIds: b.survivorIds }) })); const status = d.some(x => x.startsWith('duplicate-') || x.startsWith('invalid-') || x === 'authority-incomplete' || x === 'generator-incomplete') ? 'contradictory' : d.some(x => x === 'source-authority-drift') ? 'stale' : d.some(x => x.startsWith('unsupported-') || x.startsWith('uncovered-')) ? 'blocked' : 'proven'; const repairCommand = status === 'proven' ? null : 'restore a sealed, fully covered branch authority, then regenerate examples'; return { schemaId: EXAMPLE_BRANCH_GENERATORS_SCHEMA_ID, specVersion: '0.1.0', generatorId: n.generatorId, authority: n.authority, sourceDigest: n.sourceDigest, examples, provenance: n.provenance, status, diagnostics: d, repairCommand, resultDigest: digest({ generatorId: n.generatorId, authority: n.authority, sourceDigest: n.sourceDigest, examples, provenance: n.provenance, status, diagnostics: d, repairCommand }) }; }
export const createExampleBranchGenerators = compileExampleBranchGenerators;
export function replayExampleBranchGenerators(result) { return compileExampleBranchGenerators({ authority: result.authority, generatorId: result.generatorId, branches: result.examples.map(e => ({ branchId: e.branchId, predicate: e.predicate, outcome: e.outcome, survivorIds: e.survivorIds })), sourceDigest: result.sourceDigest, provenance: result.provenance }); }
export function validateExampleBranchGenerators(result) { const r = replayExampleBranchGenerators(result), d = [...result.diagnostics]; if (result.resultDigest !== r.resultDigest)
    d.push('result-digest-mismatch'); if (result.status !== r.status)
    d.push('status-mismatch'); return { ok: d.length === 0 && result.status === 'proven', diagnostics: [...new Set(d)] }; }
function normalize(i) { return { authority: { authorityId: String(i.authority?.authorityId ?? '').trim(), digest: String(i.authority?.digest ?? '').trim(), sealed: i.authority?.sealed === true }, generatorId: String(i.generatorId ?? '').trim(), sourceDigest: String(i.sourceDigest ?? '').trim(), branches: [...(i.branches ?? [])].map(b => ({ branchId: String(b.branchId ?? '').trim(), predicate: String(b.predicate ?? '').trim(), outcome: b.outcome, survivorIds: [...(b.survivorIds ?? [])].map(String).sort() })).sort((a, b) => a.branchId.localeCompare(b.branchId)), provenance: i.provenance ?? {} }; }
function sha(v) { return createHash('sha256').update(v).digest('hex'); }
function digest(v) { return `sha256:${sha(stable(v))}`; }
function stable(v) { if (v === null || typeof v !== 'object')
    return JSON.stringify(v); if (Array.isArray(v))
    return `[${v.map(stable).join(',')}]`; const r = v; return `{${Object.keys(r).sort().map(k => `${JSON.stringify(k)}:${stable(r[k])}`).join(',')}}`; }

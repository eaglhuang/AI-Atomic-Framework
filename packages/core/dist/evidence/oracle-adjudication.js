import { createHash } from 'node:crypto';
export const ORACLE_ARBITRATION_SCHEMA_ID = 'atm.oracleArbitration.v1';
export function compileOracleArbitration(i) { const n = { ...i, arbitrationId: String(i.arbitrationId ?? '').trim(), sourceDigest: String(i.sourceDigest ?? '').trim(), observations: [...(i.observations ?? [])].map(o => ({ ...o, oracleId: String(o.oracleId ?? '').trim(), evidenceDigest: String(o.evidenceDigest ?? '').trim(), verdict: String(o.verdict ?? '').trim() })).sort((a, b) => a.oracleId.localeCompare(b.oracleId)) }; const d = []; if (!n.authority.authorityId || !n.authority.digest || !n.authority.sealed || !n.arbitrationId)
    d.push('authority-incomplete'); if (n.sourceDigest !== n.authority.digest)
    d.push('source-authority-drift'); if (!n.observations.length)
    d.push('oracle-unavailable'); if (n.writerRole === n.authorityRole)
    d.push('writer-authority-overlap'); const verdicts = new Set(n.observations.map(o => o.verdict)); for (const o of n.observations) {
    if (!o.oracleId || !o.evidenceDigest)
        d.push(`incomplete-observation:${o.oracleId}`);
    if (!o.independent)
        d.push(`non-independent-oracle:${o.oracleId}`);
} if (verdicts.size > 1)
    d.push('contradictory-oracle-output'); const status = d.some(x => x === 'writer-authority-overlap' || x === 'authority-incomplete' || x.startsWith('incomplete-')) ? 'contradictory' : d.some(x => x === 'source-authority-drift') ? 'stale' : d.length ? 'blocked' : 'proven'; return { schemaId: ORACLE_ARBITRATION_SCHEMA_ID, specVersion: '0.1.0', arbitrationId: n.arbitrationId, authority: n.authority, observations: n.observations, verdict: status === 'proven' ? 'pass' : 'fail-closed', status, diagnostics: d, repairCommand: status === 'proven' ? null : 'obtain independent oracle evidence, separate writer authority, and re-adjudicate', provenance: i.provenance ?? {}, resultDigest: digest({ arbitrationId: n.arbitrationId, authority: n.authority, observations: n.observations, verdict: status === 'proven' ? 'pass' : 'fail-closed', status, diagnostics: d }) }; }
export const createOracleArbitration = compileOracleArbitration;
export function replayOracleArbitration(r) { return compileOracleArbitration({ authority: r.authority, arbitrationId: r.arbitrationId, observations: r.observations, sourceDigest: r.authority.digest, writerRole: 'writer', authorityRole: 'oracle', provenance: r.provenance }); }
export function validateOracleArbitration(r) { const x = replayOracleArbitration(r), d = [...r.diagnostics]; if (x.resultDigest !== r.resultDigest)
    d.push('result-digest-mismatch'); return { ok: d.length === 0 && r.status === 'proven', diagnostics: [...new Set(d)] }; }
function digest(v) { return `sha256:${createHash('sha256').update(JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)).digest('hex')}`; }

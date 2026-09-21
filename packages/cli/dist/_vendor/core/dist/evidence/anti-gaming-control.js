import { createHash } from 'node:crypto';
export const ANTI_GAMING_CONTROL_SCHEMA_ID = 'atm.antiGamingControl.v1';
export function compileAntiGamingControl(i) { const n = { ...i, seedCommitment: String(i.seedCommitment ?? '').trim(), sourceDigest: String(i.sourceDigest ?? '').trim(), controls: [...(i.controls ?? [])].map(c => ({ ...c, controlId: String(c.controlId ?? '').trim(), seed: String(c.seed ?? '').trim() })).sort((a, b) => a.controlId.localeCompare(b.controlId)) }; const d = []; if (!n.authority.authorityId || !n.authority.digest || !n.authority.sealed || !n.seedCommitment)
    d.push('authority-incomplete'); if (n.sourceDigest !== n.authority.digest)
    d.push('source-authority-drift'); const seen = new Set(); for (const c of n.controls) {
    if (seen.has(c.controlId))
        d.push(`duplicate-control:${c.controlId}`);
    seen.add(c.controlId);
    if (!c.controlId || !c.seed)
        d.push(`invalid-control:${c.controlId}`);
    if (c.observed && c.observed !== c.expected)
        d.push(`control-verdict-mismatch:${c.controlId}`);
    if (!c.observed)
        d.push(`control-inconclusive:${c.controlId}`);
} const status = d.some(x => x.startsWith('duplicate-') || x.startsWith('invalid-') || x === 'authority-incomplete') ? 'contradictory' : d.some(x => x === 'source-authority-drift') ? 'stale' : d.length ? 'blocked' : 'proven'; return { schemaId: ANTI_GAMING_CONTROL_SCHEMA_ID, specVersion: '0.1.0', authority: n.authority, seedCommitment: n.seedCommitment, controls: n.controls, verdict: status === 'proven' ? 'pass' : 'fail-closed', status, diagnostics: d, repairCommand: status === 'proven' ? null : 'reseal seed/control authority and obtain complete hidden-control verdicts', provenance: i.provenance ?? {}, resultDigest: digest({ authority: n.authority, seedCommitment: n.seedCommitment, controls: n.controls, verdict: status === 'proven' ? 'pass' : 'fail-closed', status, diagnostics: d }) }; }
export const createAntiGamingControl = compileAntiGamingControl;
export function replayAntiGamingControl(r) { return compileAntiGamingControl({ authority: r.authority, seedCommitment: r.seedCommitment, controls: r.controls, sourceDigest: r.authority.digest, provenance: r.provenance }); }
export function validateAntiGamingControl(r) { const x = replayAntiGamingControl(r), d = [...r.diagnostics]; if (x.resultDigest !== r.resultDigest)
    d.push('result-digest-mismatch'); return { ok: d.length === 0 && r.status === 'proven', diagnostics: [...new Set(d)] }; }
function digest(v) { return `sha256:${createHash('sha256').update(JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)).digest('hex')}`; }

import { createHash } from 'node:crypto';
export const COVERAGE_CERTIFICATE_SCHEMA_ID = 'atm.coverageCertificate.v1';
export function compileCoverageCertificate(input) { const wasSealed = input.authority?.sealed === true, n = normalize(input), d = []; if (!n.certificateId || !n.authority.authorityId || !n.authority.digest || !wasSealed)
    d.push('authority-incomplete'); if (n.sourceDigest !== n.authority.digest)
    d.push('source-authority-drift'); if (!n.obligations.length)
    d.push('obligations-incomplete'); const seen = new Set(); for (const obligation of n.obligations) {
    if (seen.has(obligation.obligationId))
        d.push(`duplicate-obligation:${obligation.obligationId}`);
    seen.add(obligation.obligationId);
    if (!obligation.obligationId || !obligation.sourceDigest || !obligation.evidenceDigest)
        d.push(`incomplete-obligation:${obligation.obligationId}`);
    if (obligation.sourceDigest !== n.authority.digest)
        d.push(`obligation-drift:${obligation.obligationId}`);
    if (!obligation.covered || obligation.disposition !== 'closed')
        d.push(`explicit-non-claim:${obligation.obligationId}`);
} const status = d.some(x => x.startsWith('duplicate-') || x.startsWith('incomplete-') || x === 'authority-incomplete') ? 'contradictory' : d.some(x => x.includes('drift')) ? 'stale' : d.length ? 'blocked' : 'proven', nonClaims = n.obligations.filter(x => !x.covered || x.disposition !== 'closed').map(x => `does-not-claim:${x.obligationId}`); return seal({ schemaId: COVERAGE_CERTIFICATE_SCHEMA_ID, specVersion: '0.1.0', certificateId: n.certificateId, authority: n.authority, obligations: n.obligations, covered: n.obligations.filter(x => x.covered && x.disposition === 'closed').length, total: n.obligations.length, nonClaims, status, diagnostics: d, repairCommand: status === 'proven' ? null : 'restore sealed coverage authority and reconcile obligation evidence', provenance: n.provenance }); }
export const createCoverageCertificate = compileCoverageCertificate;
export function replayCoverageCertificate(r) { return compileCoverageCertificate({ authority: r.authority, certificateId: r.certificateId, obligations: r.obligations, sourceDigest: r.authority.digest, provenance: r.provenance }); }
export function validateCoverageCertificate(r) { const x = replayCoverageCertificate(r), d = [...r.diagnostics]; if (digest(unsigned(r)) !== r.resultDigest || x.resultDigest !== r.resultDigest)
    d.push('result-digest-mismatch'); return { ok: d.length === 0 && r.status === 'proven', diagnostics: [...new Set(d)] }; }
function normalize(i) { return { certificateId: String(i.certificateId ?? '').trim(), sourceDigest: String(i.sourceDigest ?? '').trim(), authority: { authorityId: String(i.authority?.authorityId ?? '').trim(), digest: String(i.authority?.digest ?? '').trim(), sealed: true }, obligations: [...(i.obligations ?? [])].map(x => ({ obligationId: String(x?.obligationId ?? '').trim(), covered: x?.covered === true, sourceDigest: String(x?.sourceDigest ?? '').trim(), evidenceDigest: String(x?.evidenceDigest ?? '').trim(), disposition: x?.disposition })).sort((a, b) => a.obligationId.localeCompare(b.obligationId)), provenance: i.provenance ?? {} }; }
function seal(x) { return { ...x, resultDigest: digest(x) }; }
function unsigned(r) { const { resultDigest, ...x } = r; return x; }
function digest(v) { return `sha256:${createHash('sha256').update(JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)).digest('hex')}`; }

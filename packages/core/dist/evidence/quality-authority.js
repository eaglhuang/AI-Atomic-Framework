import { createHash } from 'node:crypto';
export const QUALITY_AUTHORITY_SCHEMA_ID = 'atm.qualityAuthority.v1';
export function compileQualityAuthority(input) { const n = normalize(input), d = []; if (!n.authorityId || !n.policyDigest || !n.oracleDigest || !n.denominatorDigest || !n.verdictDigest)
    d.push('authority-incomplete'); if (n.policyEpoch !== n.expectedPolicyEpoch)
    d.push('policy-epoch-drift'); const missing = n.protectedSurfaces.filter(s => !n.observedProtectedSurfaces.includes(s)); for (const s of missing)
    d.push(`missing-protected-surface:${s}`); const owned = new Map(); for (const [role, caps] of Object.entries(n.roleCapabilities))
    for (const cap of caps) {
        if (owned.has(cap) && owned.get(cap) !== role)
            d.push(`capability-overlap:${cap}`);
        owned.set(cap, role);
    } if (n.roleCapabilities[n.writerRole]?.some((cap) => ['policy', 'oracle', 'denominator', 'verdict'].includes(cap)))
    d.push('writer-authority-overlap'); const status = d.some(x => x.startsWith('capability-overlap') || x === 'writer-authority-overlap' || x === 'authority-incomplete') ? 'contradictory' : d.some(x => x === 'policy-epoch-drift') ? 'stale' : d.length ? 'blocked' : 'proven'; const repairCommand = status === 'proven' ? null : 'restore the sealed prior authority, reconcile policy epoch and protected capabilities, then recompile'; const authority = { policyDigest: n.policyDigest, oracleDigest: n.oracleDigest, denominatorDigest: n.denominatorDigest, verdictDigest: n.verdictDigest, sealed: true }; return { schemaId: QUALITY_AUTHORITY_SCHEMA_ID, specVersion: '0.1.0', authorityId: n.authorityId, policyEpoch: n.policyEpoch, authority, protectedSurfaces: n.protectedSurfaces, roleCapabilities: n.roleCapabilities, status, diagnostics: d, repairCommand, authorityDigest: digest({ authorityId: n.authorityId, policyEpoch: n.policyEpoch, authority, protectedSurfaces: n.protectedSurfaces, roleCapabilities: n.roleCapabilities, status, diagnostics: d }) }; }
export const createQualityAuthority = compileQualityAuthority;
export function validateQualityAuthority(r) { return { ok: r.status === 'proven' && r.repairCommand === null && r.authority.sealed === true, diagnostics: [...r.diagnostics] }; }
function normalize(i) { const roleCapabilities = Object.fromEntries(Object.entries(i.roleCapabilities ?? {}).map(([r, c]) => [String(r), [...(c ?? [])].map(String).sort()]).sort((a, b) => a[0].localeCompare(b[0]))); return { authorityId: String(i.authorityId ?? '').trim(), policyEpoch: String(i.policyEpoch ?? '').trim(), expectedPolicyEpoch: String(i.expectedPolicyEpoch ?? '').trim(), policyDigest: String(i.policyDigest ?? '').trim(), oracleDigest: String(i.oracleDigest ?? '').trim(), denominatorDigest: String(i.denominatorDigest ?? '').trim(), verdictDigest: String(i.verdictDigest ?? '').trim(), protectedSurfaces: [...(i.protectedSurfaces ?? [])].map(String).sort(), observedProtectedSurfaces: [...(i.observedProtectedSurfaces ?? [])].map(String).sort(), roleCapabilities, writerRole: String(i.writerRole ?? '').trim() }; }
function digest(v) { return `sha256:${createHash('sha256').update(JSON.stringify(v)).digest('hex')}`; }

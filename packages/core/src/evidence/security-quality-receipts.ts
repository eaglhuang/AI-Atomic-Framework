import { createHash } from 'node:crypto';

export const SECURITY_QUALITY_RECEIPTS_SCHEMA_ID = 'atm.securityQualityReceipts.v1' as const;
export type SecurityQualityStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export interface SecurityAuthority { readonly authorityId: string; readonly digest: string; readonly sealed: true; }
export interface SecurityFinding { readonly findingId: string; readonly surface: string; readonly severity: 'low' | 'medium' | 'high' | 'critical'; readonly status: 'pass' | 'risk-accepted' | 'fail'; readonly digest: string; }
export interface RiskAcceptance { readonly findingId: string; readonly rationale: string; readonly authorityDigest: string; readonly approved: true; }
export interface SecurityQualityInput { readonly runId: string; readonly generatedAt: string; readonly authority: SecurityAuthority; readonly observedAuthorityDigest: string; readonly findings: readonly SecurityFinding[]; readonly riskAcceptances?: readonly RiskAcceptance[]; readonly requiredSurfaces?: readonly string[]; readonly supportedSeverities?: readonly string[]; readonly provenance?: Readonly<Record<string, unknown>>; }
export interface SecurityQualityResult { readonly schemaId: typeof SECURITY_QUALITY_RECEIPTS_SCHEMA_ID; readonly specVersion: '0.1.0'; readonly runId: string; readonly generatedAt: string; readonly authority: SecurityAuthority; readonly findings: readonly SecurityFinding[]; readonly riskAcceptances: readonly RiskAcceptance[]; readonly projection: { readonly findingCount: number; readonly failed: readonly string[]; readonly accepted: readonly string[]; readonly requiredSurfaces: readonly string[]; readonly missingSurfaces: readonly string[]; }; readonly status: SecurityQualityStatus; readonly diagnostics: readonly string[]; readonly repairCommand: string | null; readonly provenance: Readonly<Record<string, unknown>>; readonly resultDigest: string; }

export function compileSecurityQualityReceipts(input: SecurityQualityInput): SecurityQualityResult {
  const authorityWasSealed = input.authority?.sealed === true;
  const n = normalize(input), diagnostics: string[] = [];
  if (!n.authority.authorityId || !n.authority.digest || !authorityWasSealed) diagnostics.push('authority-incomplete');
  if (!n.runId || !n.generatedAt || !n.findings.length) diagnostics.push('receipt-incomplete');
  if (n.observedAuthorityDigest !== n.authority.digest) diagnostics.push('authority-digest-mismatch');
  const findingById = new Map<string, SecurityFinding>();
  for (const finding of n.findings) {
    if (findingById.has(finding.findingId)) diagnostics.push(`duplicate-finding:${finding.findingId}`);
    findingById.set(finding.findingId, finding);
    if (!n.supportedSeverities.includes(finding.severity)) diagnostics.push(`unsupported-severity:${finding.severity}`);
    if (!finding.findingId || !finding.surface || !finding.digest || !['pass', 'risk-accepted', 'fail'].includes(finding.status)) diagnostics.push(`incomplete-finding:${finding.findingId}`);
  }
  const accepted = new Set<string>();
  for (const acceptance of n.riskAcceptances) {
    const finding = findingById.get(acceptance.findingId);
    if (!acceptance.findingId || !acceptance.rationale || !acceptance.approved) diagnostics.push(`incomplete-risk-acceptance:${acceptance.findingId}`);
    if (acceptance.authorityDigest !== n.authority.digest) diagnostics.push(`stale-risk-acceptance:${acceptance.findingId}`);
    if (!finding || finding.status !== 'fail') diagnostics.push(`invalid-risk-acceptance:${acceptance.findingId}`);
    if (accepted.has(acceptance.findingId)) diagnostics.push(`duplicate-risk-acceptance:${acceptance.findingId}`);
    accepted.add(acceptance.findingId);
  }
  const failed = n.findings.filter(finding => finding.status === 'fail' && !accepted.has(finding.findingId)).map(finding => finding.findingId);
  if (failed.length) diagnostics.push('unaccepted-security-finding');
  const missingSurfaces = n.requiredSurfaces.filter(surface => !n.findings.some(finding => finding.surface === surface));
  for (const surface of missingSurfaces) diagnostics.push(`missing-surface:${surface}`);
  const status: SecurityQualityStatus = diagnostics.some(code => code.startsWith('duplicate-') || code.startsWith('incomplete-') || code.startsWith('invalid-') || code === 'authority-incomplete' || code === 'receipt-incomplete') ? 'contradictory' : diagnostics.some(code => code.includes('authority') || code.startsWith('stale-')) ? 'stale' : diagnostics.length ? 'blocked' : 'proven';
  const projection = { findingCount: n.findings.length, failed, accepted: [...accepted].sort(), requiredSurfaces: n.requiredSurfaces, missingSurfaces };
  const repairCommand = status === 'proven' ? null : 'repair the sealed security authority, complete required surfaces, and reissue risk acceptance receipts';
  return seal({ schemaId: SECURITY_QUALITY_RECEIPTS_SCHEMA_ID, specVersion: '0.1.0', runId: n.runId, generatedAt: n.generatedAt, authority: n.authority, findings: n.findings, riskAcceptances: n.riskAcceptances, projection, status, diagnostics, repairCommand, provenance: n.provenance });
}

export const createSecurityQualityReceipts = compileSecurityQualityReceipts;
export function replaySecurityQualityReceipts(receipt: SecurityQualityResult): SecurityQualityResult { return compileSecurityQualityReceipts({ runId: receipt.runId, generatedAt: receipt.generatedAt, authority: receipt.authority, observedAuthorityDigest: receipt.authority.digest, findings: receipt.findings, riskAcceptances: receipt.riskAcceptances, requiredSurfaces: receipt.projection.requiredSurfaces, supportedSeverities: ['low', 'medium', 'high', 'critical'], provenance: receipt.provenance }); }
export function validateSecurityQualityReceipts(receipt: SecurityQualityResult) { const replay = replaySecurityQualityReceipts(receipt), diagnostics = [...receipt.diagnostics]; const actual = digest(withoutDigest(receipt)); if (actual !== receipt.resultDigest || replay.resultDigest !== receipt.resultDigest) diagnostics.push('result-digest-mismatch'); return { ok: diagnostics.length === 0 && receipt.status === 'proven', diagnostics: [...new Set(diagnostics)] }; }

function normalize(input: SecurityQualityInput) { return { runId: String(input.runId ?? '').trim(), generatedAt: String(input.generatedAt ?? '').trim(), authority: { authorityId: String(input.authority?.authorityId ?? '').trim(), digest: String(input.authority?.digest ?? '').trim(), sealed: true as const }, observedAuthorityDigest: String(input.observedAuthorityDigest ?? '').trim(), supportedSeverities: [...(input.supportedSeverities ?? ['low', 'medium', 'high', 'critical'])].map(String).sort(), requiredSurfaces: [...(input.requiredSurfaces ?? [])].map(String).sort(), findings: [...(input.findings ?? [])].map(finding => ({ findingId: String(finding?.findingId ?? '').trim(), surface: String(finding?.surface ?? '').trim(), severity: finding?.severity, status: finding?.status, digest: String(finding?.digest ?? '').trim() } as SecurityFinding)).sort((left, right) => left.findingId.localeCompare(right.findingId)), riskAcceptances: [...(input.riskAcceptances ?? [])].map(acceptance => ({ findingId: String(acceptance?.findingId ?? '').trim(), rationale: String(acceptance?.rationale ?? '').trim(), authorityDigest: String(acceptance?.authorityDigest ?? '').trim(), approved: acceptance?.approved === true } as RiskAcceptance)).sort((left, right) => left.findingId.localeCompare(right.findingId)), provenance: input.provenance ?? {} }; }
function seal<T extends Omit<SecurityQualityResult, 'resultDigest'>>(receipt: T): SecurityQualityResult { return { ...receipt, resultDigest: digest(receipt) }; }
function withoutDigest(receipt: SecurityQualityResult): Omit<SecurityQualityResult, 'resultDigest'> { const { resultDigest: _ignored, ...unsigned } = receipt; return unsigned; }
function digest(value: unknown) { return `sha256:${createHash('sha256').update(JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item)).digest('hex')}`; }

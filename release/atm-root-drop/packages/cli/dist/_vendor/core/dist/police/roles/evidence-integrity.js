import { DEFAULT_EVIDENCE_MAX_AGE_MS } from '../constants.js';
import { makePoliceFinding, sanitizeId } from '../shared.js';
export function runEvidenceIntegrityGate(input = {}) {
    const findings = [];
    const catalog = input.catalog ?? [];
    const catalogIndex = new Map();
    for (const entry of catalog) {
        catalogIndex.set(entry.evidenceId, entry);
    }
    const now = input.nowIso ? Date.parse(input.nowIso) : Date.now();
    const maxAgeMs = input.maxAgeMs ?? DEFAULT_EVIDENCE_MAX_AGE_MS;
    for (const proposalRef of input.proposalEvidenceRefs ?? []) {
        if (proposalRef.refIds.length === 0) {
            findings.push(makePoliceFinding({
                findingId: `gate.evidence-integrity.missing.${sanitizeId(proposalRef.proposalId)}`,
                policeFamily: 'registry-consistency',
                severity: 'warning',
                trigger: 'evidence-missing',
                scope: proposalRef.proposalId,
                action: 'needs-review',
                routeHint: 'review.evidence-missing',
                readModel: 'EvidenceCatalog',
                message: `Proposal ${proposalRef.proposalId} has no evidence references.`,
                metadata: { proposalId: proposalRef.proposalId, gate: 'evidence-integrity', directApplyAllowed: false }
            }));
        }
    }
    for (const finding of input.findings ?? []) {
        const refs = finding.evidenceRefs ?? [];
        if (refs.length === 0)
            continue;
        const seenIds = new Set();
        for (const ref of refs) {
            if (seenIds.has(ref.refId)) {
                findings.push(makePoliceFinding({
                    findingId: `gate.evidence-integrity.duplicate.${sanitizeId(finding.findingId)}.${sanitizeId(ref.refId)}`,
                    policeFamily: finding.policeFamily,
                    severity: 'info',
                    trigger: 'evidence-duplicate',
                    scope: ref.refId,
                    action: 'monitor',
                    routeHint: 'monitor.evidence-duplicate',
                    readModel: 'EvidenceCatalog',
                    message: `Duplicate evidence ref ${ref.refId} on finding ${finding.findingId}.`,
                    metadata: { sourceFindingId: finding.findingId, refId: ref.refId, gate: 'evidence-integrity', directApplyAllowed: false }
                }));
                continue;
            }
            seenIds.add(ref.refId);
            const catalogEntry = catalogIndex.get(ref.refId);
            if (!catalogEntry)
                continue;
            if (catalogEntry.trustLevel === 'untrusted') {
                findings.push(makePoliceFinding({
                    findingId: `gate.evidence-integrity.untrusted.${sanitizeId(ref.refId)}`,
                    policeFamily: finding.policeFamily,
                    severity: 'warning',
                    trigger: 'evidence-untrusted',
                    scope: ref.refId,
                    action: 'request-human-review',
                    routeHint: 'review.evidence-untrusted',
                    readModel: 'EvidenceCatalog',
                    message: `Evidence ${ref.refId} marked untrusted.`,
                    metadata: { sourceFindingId: finding.findingId, refId: ref.refId, gate: 'evidence-integrity', directApplyAllowed: false }
                }));
            }
            if (ref.evidenceType && catalogEntry.evidenceType && ref.evidenceType !== catalogEntry.evidenceType) {
                findings.push(makePoliceFinding({
                    findingId: `gate.evidence-integrity.schema-mismatch.${sanitizeId(ref.refId)}`,
                    policeFamily: finding.policeFamily,
                    severity: 'warning',
                    trigger: 'evidence-schema-mismatch',
                    scope: ref.refId,
                    action: 'request-human-review',
                    routeHint: 'review.evidence-schema-mismatch',
                    readModel: 'EvidenceCatalog',
                    message: `Evidence ${ref.refId} schema mismatch: expected ${ref.evidenceType}, catalog says ${catalogEntry.evidenceType}.`,
                    metadata: { sourceFindingId: finding.findingId, refId: ref.refId, gate: 'evidence-integrity', directApplyAllowed: false }
                }));
            }
            if (catalogEntry.generatedAt) {
                const ageMs = now - Date.parse(catalogEntry.generatedAt);
                if (ageMs > maxAgeMs) {
                    findings.push(makePoliceFinding({
                        findingId: `gate.evidence-integrity.stale.${sanitizeId(ref.refId)}`,
                        policeFamily: finding.policeFamily,
                        severity: 'warning',
                        trigger: 'evidence-stale',
                        scope: ref.refId,
                        action: 'request-human-review',
                        routeHint: 'review.evidence-stale',
                        readModel: 'EvidenceCatalog',
                        message: `Evidence ${ref.refId} is stale (age ${Math.round(ageMs / (24 * 60 * 60 * 1000))} days > max ${Math.round(maxAgeMs / (24 * 60 * 60 * 1000))}).`,
                        metadata: { sourceFindingId: finding.findingId, refId: ref.refId, gate: 'evidence-integrity', directApplyAllowed: false }
                    }));
                }
            }
        }
    }
    return {
        gate: 'evidence-integrity',
        status: findings.some((f) => f.severity === 'warning' || f.severity === 'block' || f.severity === 'error') ? 'advisory' : 'pass',
        findings,
        summary: { total: findings.length },
        sourceValidator: 'runEvidenceIntegrityGate'
    };
}

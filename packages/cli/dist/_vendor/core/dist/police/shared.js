export function makeEvidenceRef(refId, refKind, evidenceType) {
    return {
        refId,
        refKind,
        evidenceType
    };
}
export function makePoliceFinding(input) {
    return {
        ...input,
        mode: input.mode ?? 'fast'
    };
}
export function makePoliceFamilyReport(input) {
    const findings = [...(input.findings ?? [])];
    return {
        family: input.family,
        mode: input.mode,
        status: input.status ?? (findings.length > 0 && input.mode === 'blocker' ? 'fail' : 'pass'),
        findings,
        advisoryOnly: input.mode === 'advisory',
        sourceValidator: input.sourceValidator
    };
}
export function toReviewAdvisorySeverity(severity) {
    if (severity === 'error' || severity === 'block') {
        return 'high';
    }
    if (severity === 'warning') {
        return 'medium';
    }
    if (severity === 'advisory') {
        return 'low';
    }
    return 'info';
}
export function toReviewAdvisoryAction(severity) {
    if (severity === 'error' || severity === 'block') {
        return 'request-human-review';
    }
    if (severity === 'warning' || severity === 'advisory') {
        return 'needs-review';
    }
    return 'monitor';
}
export function toReviewAdvisoryMachineFinding(finding) {
    return {
        id: finding.findingId,
        severity: toReviewAdvisorySeverity(finding.severity),
        message: finding.message,
        routeHint: finding.routeHint ?? 'human-review.supplemental',
        evidenceRefs: finding.evidenceRefs?.map((ref) => ref.refId),
        metadata: {
            policeFinding: finding
        }
    };
}
export function sanitizeId(value) {
    return String(value ?? 'unknown')
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'unknown';
}
export function classifyViolationFamily(code) {
    if (code.includes('DEPENDENCY_CYCLE'))
        return 'dependency-graph';
    if (code.includes('LAYER_BOUNDARY') || code.includes('LAYER_UNKNOWN') || code.includes('FORBIDDEN_IMPORT'))
        return 'boundary';
    if (code.includes('PROMOTE_BLOCKED'))
        return 'registry-consistency';
    return 'registry-consistency';
}
export function uniqueNodeRefs(input) {
    const seen = new Set();
    const result = [];
    for (const item of input) {
        const key = item?.urn ?? item?.canonicalId;
        if (!key || seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(item);
    }
    return result;
}
export function toComparableNodeRef(candidate) {
    const entry = candidate.entry && typeof candidate.entry === 'object' && !Array.isArray(candidate.entry)
        ? candidate.entry
        : undefined;
    return {
        urn: candidate.urn,
        canonicalId: candidate.canonicalId,
        nodeKind: candidate.nodeKind,
        entry
    };
}
export function isPolymorphIgnored(nodeRef, ignoredAtomIds, ignoredGroupId) {
    const atomId = nodeRef?.canonicalId ?? nodeRef?.entry?.atomId;
    if (atomId && ignoredAtomIds.has(atomId)) {
        return true;
    }
    return Boolean(ignoredGroupId && nodeRef?.entry?.polymorphGroupId === ignoredGroupId);
}

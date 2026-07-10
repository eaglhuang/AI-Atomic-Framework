import type {
  CorePoliceFacadeInput,
  EvidenceRef,
  PoliceFamilyName,
  PoliceFamilyReport,
  PoliceFinding,
  PoliceFindingSeverity
} from './types.ts';

export function makeEvidenceRef(
  refId: string,
  refKind: EvidenceRef['refKind'],
  evidenceType?: EvidenceRef['evidenceType']
): EvidenceRef {
  return {
    refId,
    refKind,
    evidenceType
  };
}

export function makePoliceFinding(input: Omit<PoliceFinding, 'mode'> & Partial<Pick<PoliceFinding, 'mode'>>): PoliceFinding {
  return {
    ...input,
    mode: input.mode ?? 'fast'
  };
}

export function makePoliceFamilyReport(input: CorePoliceFacadeInput): PoliceFamilyReport {
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

export function toReviewAdvisorySeverity(severity: PoliceFindingSeverity): 'high' | 'medium' | 'low' | 'info' {
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

export function toReviewAdvisoryAction(severity: PoliceFindingSeverity): 'monitor' | 'needs-review' | 'request-human-review' {
  if (severity === 'error' || severity === 'block') {
    return 'request-human-review';
  }
  if (severity === 'warning' || severity === 'advisory') {
    return 'needs-review';
  }
  return 'monitor';
}

export function toReviewAdvisoryMachineFinding(finding: PoliceFinding) {
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

export function sanitizeId(value: unknown): string {
  return String(value ?? 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

export function classifyViolationFamily(code: string): PoliceFamilyName {
  if (code.includes('DEPENDENCY_CYCLE')) return 'dependency-graph';
  if (code.includes('LAYER_BOUNDARY') || code.includes('LAYER_UNKNOWN') || code.includes('FORBIDDEN_IMPORT')) return 'boundary';
  if (code.includes('PROMOTE_BLOCKED')) return 'registry-consistency';
  return 'registry-consistency';
}

export type ComparableNodeRef = {
  readonly urn?: string;
  readonly canonicalId?: string;
  readonly nodeKind?: string;
  readonly entry?: Record<string, unknown>;
};

export function uniqueNodeRefs(input: readonly { urn?: string; canonicalId?: string; nodeKind?: string; entry?: Record<string, unknown> }[]): { urn?: string; canonicalId: string; nodeKind?: string; entry?: Record<string, unknown> }[] {
  const seen = new Set<string>();
  const result: { urn?: string; canonicalId: string; nodeKind?: string; entry?: Record<string, unknown> }[] = [];
  for (const item of input) {
    const key = item?.urn ?? item?.canonicalId;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item as { urn?: string; canonicalId: string; nodeKind?: string; entry?: Record<string, unknown> });
  }
  return result;
}

export function toComparableNodeRef(candidate: { urn?: string; canonicalId?: string; nodeKind?: string; entry?: unknown }): ComparableNodeRef {
  const entry = candidate.entry && typeof candidate.entry === 'object' && !Array.isArray(candidate.entry)
    ? candidate.entry as Record<string, unknown>
    : undefined;
  return {
    urn: candidate.urn,
    canonicalId: candidate.canonicalId,
    nodeKind: candidate.nodeKind,
    entry
  };
}

export function isPolymorphIgnored(nodeRef: { canonicalId?: string; entry?: Record<string, unknown> } | undefined, ignoredAtomIds: ReadonlySet<string>, ignoredGroupId: string | null): boolean {
  const atomId = nodeRef?.canonicalId ?? (nodeRef?.entry?.atomId as string | undefined);
  if (atomId && ignoredAtomIds.has(atomId)) {
    return true;
  }
  return Boolean(ignoredGroupId && nodeRef?.entry?.polymorphGroupId === ignoredGroupId);
}

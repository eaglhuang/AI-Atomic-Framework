import type { CorePoliceFacadeInput, EvidenceRef, PoliceFamilyName, PoliceFamilyReport, PoliceFinding, PoliceFindingSeverity } from './types.ts';
export declare function makeEvidenceRef(refId: string, refKind: EvidenceRef['refKind'], evidenceType?: EvidenceRef['evidenceType']): EvidenceRef;
export declare function makePoliceFinding(input: Omit<PoliceFinding, 'mode'> & Partial<Pick<PoliceFinding, 'mode'>>): PoliceFinding;
export declare function makePoliceFamilyReport(input: CorePoliceFacadeInput): PoliceFamilyReport;
export declare function toReviewAdvisorySeverity(severity: PoliceFindingSeverity): 'high' | 'medium' | 'low' | 'info';
export declare function toReviewAdvisoryAction(severity: PoliceFindingSeverity): 'monitor' | 'needs-review' | 'request-human-review';
export declare function toReviewAdvisoryMachineFinding(finding: PoliceFinding): {
    id: string;
    severity: "low" | "medium" | "high" | "info";
    message: string;
    routeHint: string;
    evidenceRefs: string[] | undefined;
    metadata: {
        policeFinding: PoliceFinding;
    };
};
export declare function sanitizeId(value: unknown): string;
export declare function classifyViolationFamily(code: string): PoliceFamilyName;
export type ComparableNodeRef = {
    readonly urn?: string;
    readonly canonicalId?: string;
    readonly nodeKind?: string;
    readonly entry?: Record<string, unknown>;
};
export declare function uniqueNodeRefs(input: readonly {
    urn?: string;
    canonicalId?: string;
    nodeKind?: string;
    entry?: Record<string, unknown>;
}[]): {
    urn?: string;
    canonicalId: string;
    nodeKind?: string;
    entry?: Record<string, unknown>;
}[];
export declare function toComparableNodeRef(candidate: {
    urn?: string;
    canonicalId?: string;
    nodeKind?: string;
    entry?: unknown;
}): ComparableNodeRef;
export declare function isPolymorphIgnored(nodeRef: {
    canonicalId?: string;
    entry?: Record<string, unknown>;
} | undefined, ignoredAtomIds: ReadonlySet<string>, ignoredGroupId: string | null): boolean;

export declare const FOUR_PLAN_INDEPENDENT_CERTIFICATE_SCHEMA_ID: "atm.fourPlanIndependentCertificate.v1";
export type FourPlanCertificateStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export type FourPlanVerdictStatus = 'proven' | 'not-complete' | 'unknown' | 'unavailable' | 'stale' | 'override' | 'unauthorized' | 'conflicting';
/**
 * Release surfaces whose absence is itself a defect. A certificate that never
 * names where the code is cannot authorize its release, so these two are
 * required rather than merely checked when present.
 */
export declare const REQUIRED_RELEASE_SURFACE_IDS: readonly ["origin-main", "target-head"];
export interface FourPlanDimensionVerdict {
    readonly dimensionId: string;
    readonly status: FourPlanVerdictStatus;
    readonly digest: string;
    readonly evidenceRefs: readonly string[];
    readonly reviewerRole?: string | null;
}
export interface FourPlanReleaseSurface {
    readonly surfaceId: string;
    readonly expectedDigest: string;
    readonly observedDigest: string;
    readonly reachable: boolean;
}
export interface FourPlanReviewer {
    readonly reviewerId: string;
    readonly roles: readonly string[];
    readonly outputPath: string;
    readonly digest: string;
    /** Paths actually recomputed by this reviewer.  Digests alone cannot bind a
     * review to observable evidence or prove that the reviewer read it. */
    readonly inputPaths?: readonly string[];
    /**
     * Digests of the artifacts this reviewer recomputed from. A review that
     * cannot say what it read is a signature, not a review.
     */
    readonly inputDigests?: readonly string[];
}
/**
 * What was actually on disk when the certificate was compiled. The compiler is
 * pure; the caller reads the filesystem and the repository and hands the
 * readings over, so every judgement below is reproducible from the certificate
 * alone.
 */
export interface FourPlanEvidenceObservation {
    readonly path: string;
    readonly present: boolean;
    readonly digest: string;
    readonly tracked: boolean;
    readonly dirty: boolean;
    readonly lastCommit: string;
    readonly reachableFromTargetHead: boolean;
}
export interface FourPlanIndependentCertificateInput {
    readonly certificateId: string;
    readonly certificatePath?: string;
    readonly generatedAt: string;
    readonly writerRole: string;
    readonly reviewers: readonly FourPlanReviewer[];
    readonly minimumIndependentReviewers: number;
    readonly forbiddenReviewerRoles: readonly string[];
    readonly dimensions: readonly FourPlanDimensionVerdict[];
    readonly evidenceObservations?: readonly FourPlanEvidenceObservation[];
    readonly releaseSurfaces: readonly FourPlanReleaseSurface[];
    readonly mutationControls: readonly string[];
    readonly provenance: Readonly<Record<string, unknown>>;
}
export interface FourPlanIndependentCertificate {
    readonly schemaId: typeof FOUR_PLAN_INDEPENDENT_CERTIFICATE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly certificateId: string;
    readonly certificatePath: string;
    readonly generatedAt: string;
    readonly writerRole: string;
    readonly reviewers: readonly Required<FourPlanReviewer>[];
    readonly minimumIndependentReviewers: number;
    readonly independentReviewerCount: number;
    readonly forbiddenReviewerRoles: readonly string[];
    readonly dimensions: readonly FourPlanDimensionVerdict[];
    readonly evidenceObservations: readonly FourPlanEvidenceObservation[];
    readonly releaseSurfaces: readonly FourPlanReleaseSurface[];
    readonly mutationControls: readonly string[];
    readonly status: FourPlanCertificateStatus;
    readonly overallVerdict: 'complete' | 'not-complete';
    readonly diagnostics: readonly string[];
    readonly nonClaims: readonly string[];
    readonly releaseAuthorized: boolean;
    readonly provenance: Readonly<Record<string, unknown>>;
    readonly certificateDigest: string;
}
/**
 * The canonical way to summarise several evidence artifacts under one digest.
 * A dimension that cites more than one file may use this instead of a single
 * file digest; anything else is unreproducible and is reported as such.
 */
export declare function composeEvidenceDigest(entries: readonly {
    readonly path: string;
    readonly digest: string;
}[]): string;
export declare function compileFourPlanIndependentCertificate(input: FourPlanIndependentCertificateInput): FourPlanIndependentCertificate;
export declare function validateFourPlanIndependentCertificate(result: FourPlanIndependentCertificate): {
    ok: boolean;
    diagnostics: string[];
};

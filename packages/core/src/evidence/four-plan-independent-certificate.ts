import { createHash } from 'node:crypto';

export const FOUR_PLAN_INDEPENDENT_CERTIFICATE_SCHEMA_ID = 'atm.fourPlanIndependentCertificate.v1' as const;
export type FourPlanCertificateStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export type FourPlanVerdictStatus = 'proven' | 'not-complete' | 'unknown' | 'unavailable' | 'stale' | 'override' | 'unauthorized' | 'conflicting';

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
}

export interface FourPlanIndependentCertificateInput {
  readonly certificateId: string;
  readonly generatedAt: string;
  readonly writerRole: string;
  readonly reviewers: readonly FourPlanReviewer[];
  readonly minimumIndependentReviewers: number;
  readonly forbiddenReviewerRoles: readonly string[];
  readonly dimensions: readonly FourPlanDimensionVerdict[];
  readonly releaseSurfaces: readonly FourPlanReleaseSurface[];
  readonly mutationControls: readonly string[];
  readonly provenance: Readonly<Record<string, unknown>>;
}

export interface FourPlanIndependentCertificate {
  readonly schemaId: typeof FOUR_PLAN_INDEPENDENT_CERTIFICATE_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly certificateId: string;
  readonly generatedAt: string;
  readonly writerRole: string;
  readonly reviewers: readonly FourPlanReviewer[];
  readonly minimumIndependentReviewers: number;
  readonly forbiddenReviewerRoles: readonly string[];
  readonly dimensions: readonly FourPlanDimensionVerdict[];
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

const terminalGood = new Set<FourPlanVerdictStatus>(['proven']);
const failClosedStatuses = new Set<FourPlanVerdictStatus>([
  'not-complete',
  'unknown',
  'unavailable',
  'stale',
  'override',
  'unauthorized',
  'conflicting'
]);

export function compileFourPlanIndependentCertificate(input: FourPlanIndependentCertificateInput): FourPlanIndependentCertificate {
  const normalized = normalize(input);
  const diagnostics: string[] = [];
  const nonClaims: string[] = [];
  if (!normalized.certificateId || !normalized.writerRole) diagnostics.push('certificate-identity-incomplete');
  if (normalized.reviewers.length < normalized.minimumIndependentReviewers) diagnostics.push('independent-reviewer-count-insufficient');
  const reviewerOutputs = new Set<string>();
  for (const reviewer of normalized.reviewers) {
    if (!reviewer.reviewerId || !reviewer.outputPath || !reviewer.digest) diagnostics.push(`reviewer-incomplete:${reviewer.reviewerId || 'unknown'}`);
    if (reviewerOutputs.has(reviewer.outputPath)) diagnostics.push(`reviewer-output-overlap:${reviewer.outputPath}`);
    reviewerOutputs.add(reviewer.outputPath);
    const forbidden = reviewer.roles.filter((role) => normalized.forbiddenReviewerRoles.includes(role) || role === normalized.writerRole);
    for (const role of forbidden) diagnostics.push(`reviewer-role-not-independent:${reviewer.reviewerId}:${role}`);
  }
  if (normalized.dimensions.length === 0) diagnostics.push('dimension-verdicts-missing');
  for (const dimension of normalized.dimensions) {
    if (!dimension.dimensionId || !dimension.digest) diagnostics.push(`dimension-incomplete:${dimension.dimensionId || 'unknown'}`);
    if (failClosedStatuses.has(dimension.status)) {
      diagnostics.push(`dimension-fail-closed:${dimension.dimensionId}:${dimension.status}`);
      nonClaims.push(`does-not-claim-complete:${dimension.dimensionId}`);
    } else if (!terminalGood.has(dimension.status)) {
      diagnostics.push(`dimension-status-invalid:${dimension.dimensionId}:${dimension.status}`);
    }
    if (dimension.evidenceRefs.length === 0) diagnostics.push(`dimension-evidence-missing:${dimension.dimensionId}`);
  }
  if (normalized.releaseSurfaces.length === 0) diagnostics.push('release-surfaces-missing');
  for (const surface of normalized.releaseSurfaces) {
    if (!surface.surfaceId || !surface.expectedDigest || !surface.observedDigest) diagnostics.push(`release-surface-incomplete:${surface.surfaceId || 'unknown'}`);
    if (surface.expectedDigest !== surface.observedDigest) {
      diagnostics.push(`release-digest-mismatch:${surface.surfaceId}`);
      nonClaims.push(`does-not-authorize-release:${surface.surfaceId}`);
    }
    if (!surface.reachable) {
      diagnostics.push(`release-surface-unreachable:${surface.surfaceId}`);
      nonClaims.push(`does-not-authorize-release:${surface.surfaceId}`);
    }
  }
  if (normalized.mutationControls.length === 0) diagnostics.push('mutation-controls-missing');
  const status: FourPlanCertificateStatus = diagnostics.some((entry) =>
    entry.includes('not-independent') ||
    entry.includes('overlap') ||
    entry.includes('invalid') ||
    entry.includes('incomplete')
  ) ? 'contradictory' : diagnostics.some((entry) =>
    entry.includes('mismatch') ||
    entry.includes('stale')
  ) ? 'stale' : diagnostics.length ? 'blocked' : 'proven';
  const unsigned = {
    schemaId: FOUR_PLAN_INDEPENDENT_CERTIFICATE_SCHEMA_ID,
    specVersion: '0.1.0' as const,
    certificateId: normalized.certificateId,
    generatedAt: normalized.generatedAt,
    writerRole: normalized.writerRole,
    reviewers: normalized.reviewers,
    minimumIndependentReviewers: normalized.minimumIndependentReviewers,
    forbiddenReviewerRoles: normalized.forbiddenReviewerRoles,
    dimensions: normalized.dimensions,
    releaseSurfaces: normalized.releaseSurfaces,
    mutationControls: normalized.mutationControls,
    status,
    overallVerdict: status === 'proven' ? 'complete' as const : 'not-complete' as const,
    diagnostics: [...new Set(diagnostics)].sort(),
    nonClaims: [...new Set(nonClaims)].sort(),
    releaseAuthorized: status === 'proven',
    provenance: normalized.provenance
  };
  return { ...unsigned, certificateDigest: digest(unsigned) };
}

export function validateFourPlanIndependentCertificate(result: FourPlanIndependentCertificate) {
  const { certificateDigest, ...unsigned } = result;
  const diagnostics = digest(unsigned) === certificateDigest ? [...result.diagnostics] : [...result.diagnostics, 'certificate-digest-mismatch'];
  return { ok: diagnostics.length === 0 && result.status === 'proven' && result.releaseAuthorized === true, diagnostics: [...new Set(diagnostics)].sort() };
}

function normalize(input: FourPlanIndependentCertificateInput) {
  return {
    certificateId: String(input.certificateId ?? '').trim(),
    generatedAt: String(input.generatedAt ?? new Date(0).toISOString()).trim(),
    writerRole: String(input.writerRole ?? '').trim(),
    reviewers: [...(input.reviewers ?? [])].map((reviewer) => ({
      reviewerId: String(reviewer.reviewerId ?? '').trim(),
      roles: [...(reviewer.roles ?? [])].map(String).sort(),
      outputPath: normalizePath(reviewer.outputPath),
      digest: String(reviewer.digest ?? '').trim()
    })).sort((left, right) => left.reviewerId.localeCompare(right.reviewerId)),
    minimumIndependentReviewers: Math.max(0, Number(input.minimumIndependentReviewers ?? 0)),
    forbiddenReviewerRoles: [...(input.forbiddenReviewerRoles ?? [])].map(String).sort(),
    dimensions: [...(input.dimensions ?? [])].map((dimension) => ({
      dimensionId: String(dimension.dimensionId ?? '').trim(),
      status: String(dimension.status ?? 'unknown').trim() as FourPlanVerdictStatus,
      digest: String(dimension.digest ?? '').trim(),
      evidenceRefs: [...(dimension.evidenceRefs ?? [])].map(normalizePath).sort(),
      reviewerRole: dimension.reviewerRole == null ? null : String(dimension.reviewerRole)
    })).sort((left, right) => left.dimensionId.localeCompare(right.dimensionId)),
    releaseSurfaces: [...(input.releaseSurfaces ?? [])].map((surface) => ({
      surfaceId: String(surface.surfaceId ?? '').trim(),
      expectedDigest: String(surface.expectedDigest ?? '').trim(),
      observedDigest: String(surface.observedDigest ?? '').trim(),
      reachable: surface.reachable === true
    })).sort((left, right) => left.surfaceId.localeCompare(right.surfaceId)),
    mutationControls: [...(input.mutationControls ?? [])].map(String).sort(),
    provenance: input.provenance ?? {}
  };
}

function normalizePath(value: string): string {
  return String(value ?? '').replace(/\\/g, '/').trim();
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value, (_, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
      : item
  )).digest('hex')}`;
}

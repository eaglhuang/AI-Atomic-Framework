import { createHash } from 'node:crypto';
export const FOUR_PLAN_INDEPENDENT_CERTIFICATE_SCHEMA_ID = 'atm.fourPlanIndependentCertificate.v1';
/**
 * Release surfaces whose absence is itself a defect. A certificate that never
 * names where the code is cannot authorize its release, so these two are
 * required rather than merely checked when present.
 */
export const REQUIRED_RELEASE_SURFACE_IDS = ['origin-main', 'target-head'];
const DIGEST_SHAPE = /^sha256:[0-9a-f]{64}$/;
const COMMIT_SHAPE = /^[0-9a-f]{40}$/;
const terminalGood = new Set(['proven']);
const failClosedStatuses = new Set([
    'not-complete',
    'unknown',
    'unavailable',
    'stale',
    'override',
    'unauthorized',
    'conflicting'
]);
/**
 * The canonical way to summarise several evidence artifacts under one digest.
 * A dimension that cites more than one file may use this instead of a single
 * file digest; anything else is unreproducible and is reported as such.
 */
export function composeEvidenceDigest(entries) {
    const payload = [...entries]
        .map((entry) => `${normalizePath(entry.path)} ${String(entry.digest ?? '').trim()}`)
        .sort()
        .join('\n');
    return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}
export function compileFourPlanIndependentCertificate(input) {
    const normalized = normalize(input);
    const diagnostics = new Map();
    const nonClaims = new Set();
    const push = (code, severity) => {
        const existing = diagnostics.get(code);
        if (existing === undefined || rank(severity) > rank(existing))
            diagnostics.set(code, severity);
    };
    if (!normalized.certificateId || !normalized.writerRole)
        push('certificate-identity-incomplete', 'contradictory');
    if (!normalized.certificatePath)
        push('certificate-path-missing', 'blocked');
    const observations = new Map(normalized.evidenceObservations.map((entry) => [entry.path, entry]));
    const certifiedEvidence = new Set(normalized.dimensions.flatMap((dimension) => dimension.evidenceRefs));
    let independentReviewerCount = 0;
    const seenReviewerIds = new Set();
    const seenReviewerOutputs = new Set();
    for (const reviewer of normalized.reviewers) {
        const before = diagnostics.size;
        const label = reviewer.reviewerId || 'unknown';
        if (!reviewer.reviewerId || !reviewer.outputPath || !reviewer.digest)
            push(`reviewer-incomplete:${label}`, 'contradictory');
        if (!DIGEST_SHAPE.test(reviewer.digest))
            push(`reviewer-digest-malformed:${label}`, 'contradictory');
        if (reviewer.inputPaths.length === 0)
            push(`reviewer-input-paths-missing:${label}`, 'contradictory');
        if (reviewer.inputDigests.length === 0)
            push(`reviewer-input-digests-missing:${label}`, 'contradictory');
        for (const inputDigest of reviewer.inputDigests) {
            if (!DIGEST_SHAPE.test(inputDigest))
                push(`reviewer-input-digest-malformed:${label}`, 'contradictory');
            if (inputDigest === reviewer.digest)
                push(`reviewer-input-equals-output:${label}`, 'contradictory');
        }
        if (seenReviewerIds.has(reviewer.reviewerId))
            push(`reviewer-duplicate-identity:${label}`, 'contradictory');
        seenReviewerIds.add(reviewer.reviewerId);
        if (seenReviewerOutputs.has(reviewer.outputPath))
            push(`reviewer-output-overlap:${reviewer.outputPath}`, 'contradictory');
        seenReviewerOutputs.add(reviewer.outputPath);
        if (normalized.certificatePath && reviewer.outputPath === normalized.certificatePath) {
            push(`reviewer-output-self-reference:${label}`, 'contradictory');
        }
        if (reviewer.reviewerId === normalized.writerRole)
            push(`reviewer-identity-collides-with-writer:${label}`, 'contradictory');
        if (certifiedEvidence.has(reviewer.outputPath)) {
            push(`reviewer-output-is-certified-evidence:${label}`, 'contradictory');
        }
        const observedInputs = reviewer.inputPaths.map((path) => observations.get(path) ?? null);
        if (observedInputs.some((entry) => entry === null)) {
            push(`reviewer-input-observation-missing:${label}`, 'blocked');
        }
        else {
            const observedDigests = observedInputs
                .filter((entry) => entry !== null)
                .map((entry) => entry.digest)
                .sort();
            if (JSON.stringify(observedDigests) !== JSON.stringify(reviewer.inputDigests)) {
                push(`reviewer-input-digests-unreproducible:${label}`, 'stale');
            }
        }
        const forbidden = reviewer.roles.filter((role) => normalized.forbiddenReviewerRoles.includes(role) || role === normalized.writerRole);
        for (const role of forbidden)
            push(`reviewer-role-not-independent:${reviewer.reviewerId}:${role}`, 'contradictory');
        const observed = observations.get(reviewer.outputPath);
        if (observed && observed.present && observed.digest !== reviewer.digest) {
            push(`reviewer-output-digest-mismatch:${label}`, 'stale');
        }
        if (diagnostics.size === before)
            independentReviewerCount += 1;
    }
    if (independentReviewerCount < normalized.minimumIndependentReviewers) {
        push('independent-reviewer-count-insufficient', 'blocked');
    }
    if (normalized.dimensions.length === 0)
        push('dimension-verdicts-missing', 'blocked');
    for (const dimension of normalized.dimensions) {
        const label = dimension.dimensionId || 'unknown';
        if (!dimension.dimensionId || !dimension.digest)
            push(`dimension-incomplete:${label}`, 'contradictory');
        if (!DIGEST_SHAPE.test(dimension.digest))
            push(`dimension-digest-malformed:${label}`, 'contradictory');
        if (failClosedStatuses.has(dimension.status)) {
            push(`dimension-fail-closed:${label}:${dimension.status}`, 'blocked');
            nonClaims.add(`does-not-claim-complete:${label}`);
        }
        else if (!terminalGood.has(dimension.status)) {
            push(`dimension-status-invalid:${label}:${dimension.status}`, 'contradictory');
        }
        if (dimension.evidenceRefs.length === 0) {
            push(`dimension-evidence-missing:${label}`, 'blocked');
            continue;
        }
        const observedRefs = dimension.evidenceRefs.map((path) => observations.get(path) ?? null);
        if (observedRefs.some((entry) => entry === null))
            continue;
        const present = observedRefs.filter((entry) => entry !== null && entry.present);
        if (present.length !== dimension.evidenceRefs.length)
            continue;
        const singleMatch = present.some((entry) => entry.digest === dimension.digest);
        const compositeMatch = composeEvidenceDigest(present) === dimension.digest;
        if (!singleMatch && !compositeMatch) {
            push(`dimension-digest-unreproducible:${label}`, 'stale');
            nonClaims.add(`does-not-claim-complete:${label}`);
        }
    }
    const referencedPaths = new Set([
        ...certifiedEvidence,
        ...normalized.reviewers.map((reviewer) => reviewer.outputPath)
    ]);
    referencedPaths.delete('');
    referencedPaths.delete(normalized.certificatePath);
    for (const path of [...referencedPaths].sort()) {
        const observation = observations.get(path);
        if (!observation) {
            push(`evidence-observation-missing:${path}`, 'blocked');
            continue;
        }
        if (!observation.present) {
            push(`evidence-unreadable:${path}`, 'blocked');
            continue;
        }
        if (!DIGEST_SHAPE.test(observation.digest))
            push(`evidence-digest-malformed:${path}`, 'contradictory');
        if (!observation.tracked)
            push(`evidence-untracked:${path}`, 'blocked');
        else if (observation.dirty)
            push(`evidence-uncommitted:${path}`, 'stale');
        else if (!observation.reachableFromTargetHead)
            push(`evidence-newer-than-certificate:${path}`, 'stale');
    }
    if (normalized.releaseSurfaces.length === 0)
        push('release-surfaces-missing', 'blocked');
    const surfaceIds = new Set(normalized.releaseSurfaces.map((surface) => surface.surfaceId));
    for (const required of REQUIRED_RELEASE_SURFACE_IDS) {
        if (!surfaceIds.has(required))
            push(`release-surface-required-missing:${required}`, 'blocked');
    }
    for (const surface of normalized.releaseSurfaces) {
        const label = surface.surfaceId || 'unknown';
        if (!surface.surfaceId || !surface.expectedDigest || !surface.observedDigest)
            push(`release-surface-incomplete:${label}`, 'contradictory');
        if (REQUIRED_RELEASE_SURFACE_IDS.includes(surface.surfaceId)) {
            if (!COMMIT_SHAPE.test(surface.expectedDigest) || !COMMIT_SHAPE.test(surface.observedDigest)) {
                push(`release-surface-commit-malformed:${label}`, 'contradictory');
            }
        }
        const commitSurface = REQUIRED_RELEASE_SURFACE_IDS.includes(surface.surfaceId);
        if (!surface.reachable) {
            push(`release-surface-unreachable:${label}`, 'blocked');
            nonClaims.add(`does-not-authorize-release:${label}`);
        }
        else if (surface.expectedDigest !== surface.observedDigest && !commitSurface) {
            push(`release-digest-mismatch:${label}`, 'stale');
            nonClaims.add(`does-not-authorize-release:${label}`);
        }
    }
    if (normalized.mutationControls.length === 0)
        push('mutation-controls-missing', 'blocked');
    const status = worstStatus([...diagnostics.values()]);
    const unsigned = {
        schemaId: FOUR_PLAN_INDEPENDENT_CERTIFICATE_SCHEMA_ID,
        specVersion: '0.1.0',
        certificateId: normalized.certificateId,
        certificatePath: normalized.certificatePath,
        generatedAt: normalized.generatedAt,
        writerRole: normalized.writerRole,
        reviewers: normalized.reviewers,
        minimumIndependentReviewers: normalized.minimumIndependentReviewers,
        independentReviewerCount,
        forbiddenReviewerRoles: normalized.forbiddenReviewerRoles,
        dimensions: normalized.dimensions,
        evidenceObservations: normalized.evidenceObservations,
        releaseSurfaces: normalized.releaseSurfaces,
        mutationControls: normalized.mutationControls,
        status,
        overallVerdict: status === 'proven' ? 'complete' : 'not-complete',
        diagnostics: [...diagnostics.keys()].sort(),
        nonClaims: [...nonClaims].sort(),
        releaseAuthorized: status === 'proven',
        provenance: normalized.provenance
    };
    return { ...unsigned, certificateDigest: digest(unsigned) };
}
export function validateFourPlanIndependentCertificate(result) {
    const { certificateDigest, ...unsigned } = result;
    const diagnostics = [...result.diagnostics];
    if (digest(unsigned) !== certificateDigest)
        diagnostics.push('certificate-digest-mismatch');
    const provenVerdict = result.status === 'proven';
    if (result.overallVerdict !== (provenVerdict ? 'complete' : 'not-complete'))
        diagnostics.push('certificate-verdict-inconsistent');
    if (result.releaseAuthorized !== provenVerdict)
        diagnostics.push('certificate-release-authorization-inconsistent');
    if (provenVerdict && result.diagnostics.length > 0)
        diagnostics.push('certificate-verdict-inconsistent');
    const ok = diagnostics.length === 0 && result.status === 'proven' && result.releaseAuthorized === true;
    return { ok, diagnostics: [...new Set(diagnostics)].sort() };
}
function rank(severity) {
    return severity === 'contradictory' ? 3 : severity === 'stale' ? 2 : 1;
}
function worstStatus(severities) {
    if (severities.length === 0)
        return 'proven';
    const worst = severities.reduce((left, right) => (rank(right) > rank(left) ? right : left));
    return worst;
}
function normalize(input) {
    return {
        certificateId: String(input.certificateId ?? '').trim(),
        certificatePath: normalizePath(input.certificatePath ?? ''),
        generatedAt: String(input.generatedAt ?? new Date(0).toISOString()).trim(),
        writerRole: String(input.writerRole ?? '').trim(),
        reviewers: [...(input.reviewers ?? [])].map((reviewer) => ({
            reviewerId: String(reviewer.reviewerId ?? '').trim(),
            roles: [...(reviewer.roles ?? [])].map(String).sort(),
            outputPath: normalizePath(reviewer.outputPath),
            digest: String(reviewer.digest ?? '').trim(),
            inputPaths: [...(reviewer.inputPaths ?? [])].map(normalizePath).sort(),
            inputDigests: [...(reviewer.inputDigests ?? [])].map((entry) => String(entry ?? '').trim()).sort()
        })).sort((left, right) => left.reviewerId.localeCompare(right.reviewerId)),
        minimumIndependentReviewers: Math.max(0, Number(input.minimumIndependentReviewers ?? 0)),
        forbiddenReviewerRoles: [...(input.forbiddenReviewerRoles ?? [])].map(String).sort(),
        dimensions: [...(input.dimensions ?? [])].map((dimension) => ({
            dimensionId: String(dimension.dimensionId ?? '').trim(),
            status: String(dimension.status ?? 'unknown').trim(),
            digest: String(dimension.digest ?? '').trim(),
            evidenceRefs: [...(dimension.evidenceRefs ?? [])].map(normalizePath).sort(),
            reviewerRole: dimension.reviewerRole == null ? null : String(dimension.reviewerRole)
        })).sort((left, right) => left.dimensionId.localeCompare(right.dimensionId)),
        evidenceObservations: [...(input.evidenceObservations ?? [])].map((observation) => ({
            path: normalizePath(observation.path),
            present: observation.present === true,
            digest: String(observation.digest ?? '').trim(),
            tracked: observation.tracked === true,
            dirty: observation.dirty === true,
            lastCommit: String(observation.lastCommit ?? '').trim(),
            reachableFromTargetHead: observation.reachableFromTargetHead === true
        })).sort((left, right) => left.path.localeCompare(right.path)),
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
function normalizePath(value) {
    return String(value ?? '').replace(/\\/g, '/').trim();
}
function digest(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
        : item)).digest('hex')}`;
}

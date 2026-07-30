import { createHash } from 'node:crypto';
export const INCIDENT_LEARNING_CANDIDATE_SCHEMA_ID = 'atm.incidentLearningCandidate.v1';
export function createIncidentLearningCandidate(input) {
    const symptom = input.symptom.trim();
    const reproductionRefs = uniqueNonEmpty(input.reproductionRefs);
    const receiptRefs = uniqueNonEmpty(input.receiptRefs);
    const invariantRefs = uniqueNonEmpty(input.invariantRefs);
    const acceptanceRefs = uniqueNonEmpty(input.acceptanceRefs);
    const observedFactors = uniqueNonEmpty(input.observedFactors);
    const publicSeam = normalizeNullable(input.publicSeam);
    const stateFrom = normalizeNullable(input.stateTransition?.from);
    const stateTo = normalizeNullable(input.stateTransition?.to);
    const unknowns = collectUnknowns({
        symptom,
        reproductionRefs,
        receiptRefs,
        invariantRefs,
        acceptanceRefs,
        publicSeam,
        stateFrom,
        stateTo,
        observedFactors
    });
    const availability = classifyEvidenceAvailability({ reproductionRefs, receiptRefs, unknowns });
    return {
        schemaId: INCIDENT_LEARNING_CANDIDATE_SCHEMA_ID,
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Initial evidence-bounded incident learning candidate.'
        },
        candidateId: `ilc-${digestJson({
            reportedAt: input.reportedAt,
            repo: input.repo,
            backlogItemId: input.backlogItemId ?? null,
            taskId: input.taskId ?? null,
            symptom,
            publicSeam,
            stateFrom,
            stateTo
        }).slice('sha256:'.length, 'sha256:'.length + 16)}`,
        sourceIncident: {
            reportedAt: input.reportedAt,
            repo: input.repo.trim(),
            backlogItemId: normalizeNullable(input.backlogItemId),
            taskId: normalizeNullable(input.taskId)
        },
        symptom,
        evidence: {
            availability,
            reproductionRefs,
            receiptRefs,
            invariantRefs,
            acceptanceRefs
        },
        publicSeam,
        stateTransition: {
            from: stateFrom,
            to: stateTo
        },
        observedFactors,
        breadthHypotheses: deriveBreadthHypotheses({ publicSeam, stateFrom, stateTo, invariantRefs }),
        depthHypotheses: deriveDepthHypotheses({ publicSeam, stateFrom, stateTo }),
        disposition: {
            rootCauseHint: normalizeNullable(input.rootCauseHint),
            familyHint: normalizeNullable(input.familyHint),
            recommendedAction: availability === 'unavailable' || availability === 'conflicting'
                ? 'needs-more-evidence'
                : 'open-task-card',
            unknowns
        },
        authorityLimits: {
            cannotAuthorizeMerge: true,
            cannotDeclareFixSuccess: true,
            cannotExcludeTests: true,
            cannotCloseTask: true,
            doesNotCreateSecondBacklog: true
        }
    };
}
export function deriveBreadthHypotheses(input) {
    const seam = input.publicSeam ?? 'unknown-public-seam';
    const transition = formatTransition(input.stateFrom, input.stateTo);
    return {
        upstreamDownstream: [`upstream and downstream callers around ${seam}`],
        samePolicyCallers: [`other callers enforcing the same policy as ${seam}`],
        siblingAdapters: [`sibling adapters that project or consume ${seam}`],
        adjacentTransitions: [`transitions adjacent to ${transition}`],
        sharedInvariants: input.invariantRefs.length > 0
            ? input.invariantRefs.map((ref) => `cases sharing invariant ${ref}`)
            : ['shared invariants unavailable until incident evidence names them']
    };
}
export function deriveDepthHypotheses(input) {
    const seam = input.publicSeam ?? 'unknown-public-seam';
    const transition = formatTransition(input.stateFrom, input.stateTo);
    return {
        boundary: [`boundary values at ${seam}`],
        negative: [`negative cases that must fail closed at ${seam}`],
        rollback: [`rollback path after ${transition}`],
        retry: [`retry/idempotency path after ${transition}`],
        concurrency: [`concurrent actor or lane interleavings near ${transition}`],
        mutation: [`mutation safety for writes near ${seam}`],
        propertyMetamorphic: ['property/metamorphic variants of observed incident factors'],
        independentOracle: ['independent oracle evidence that does not reuse the writer implementation']
    };
}
function classifyEvidenceAvailability(input) {
    if (input.unknowns.some((unknown) => unknown.includes('conflicting')))
        return 'conflicting';
    if (input.reproductionRefs.length === 0 && input.receiptRefs.length === 0)
        return 'unavailable';
    if (input.unknowns.length > 0)
        return 'partial';
    return 'available';
}
function collectUnknowns(input) {
    const unknowns = [];
    if (!input.symptom)
        unknowns.push('symptom unavailable');
    if (input.reproductionRefs.length === 0)
        unknowns.push('reproduction refs unavailable');
    if (input.receiptRefs.length === 0)
        unknowns.push('receipt refs unavailable');
    if (input.invariantRefs.length === 0)
        unknowns.push('invariant refs unavailable');
    if (input.acceptanceRefs.length === 0)
        unknowns.push('acceptance refs unavailable');
    if (!input.publicSeam)
        unknowns.push('public seam unavailable');
    if (!input.stateFrom || !input.stateTo)
        unknowns.push('state transition unavailable');
    if (input.observedFactors.length === 0)
        unknowns.push('observed factors unavailable');
    return unknowns;
}
function normalizeNullable(value) {
    const normalized = String(value ?? '').trim();
    return normalized ? normalized : null;
}
function uniqueNonEmpty(values) {
    return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}
function formatTransition(from, to) {
    return `${from ?? 'unknown'} -> ${to ?? 'unknown'}`;
}
function digestJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

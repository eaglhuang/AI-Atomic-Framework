import { createHash } from 'node:crypto';

export const INCIDENT_LEARNING_CANDIDATE_SCHEMA_ID = 'atm.incidentLearningCandidate.v1' as const;

export type IncidentEvidenceAvailability = 'available' | 'partial' | 'unavailable' | 'conflicting';
export type IncidentLearningRecommendedAction =
  | 'open-task-card'
  | 'attach-to-existing-task'
  | 'record-only'
  | 'needs-more-evidence';

export interface IncidentLearningCandidateInput {
  readonly reportedAt: string;
  readonly repo: string;
  readonly backlogItemId?: string | null;
  readonly taskId?: string | null;
  readonly symptom: string;
  readonly invariantRefs?: readonly string[];
  readonly acceptanceRefs?: readonly string[];
  readonly reproductionRefs?: readonly string[];
  readonly receiptRefs?: readonly string[];
  readonly publicSeam?: string | null;
  readonly stateTransition?: {
    readonly from?: string | null;
    readonly to?: string | null;
  };
  readonly observedFactors?: readonly string[];
  readonly rootCauseHint?: string | null;
  readonly familyHint?: string | null;
}

export interface IncidentLearningHypothesisSet {
  readonly upstreamDownstream: readonly string[];
  readonly samePolicyCallers: readonly string[];
  readonly siblingAdapters: readonly string[];
  readonly adjacentTransitions: readonly string[];
  readonly sharedInvariants: readonly string[];
}

export interface IncidentLearningDepthHypothesisSet {
  readonly boundary: readonly string[];
  readonly negative: readonly string[];
  readonly rollback: readonly string[];
  readonly retry: readonly string[];
  readonly concurrency: readonly string[];
  readonly mutation: readonly string[];
  readonly propertyMetamorphic: readonly string[];
  readonly independentOracle: readonly string[];
}

export interface IncidentLearningCandidate {
  readonly schemaId: typeof INCIDENT_LEARNING_CANDIDATE_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none';
    readonly fromVersion: null;
    readonly notes: string;
  };
  readonly candidateId: string;
  readonly sourceIncident: {
    readonly reportedAt: string;
    readonly repo: string;
    readonly backlogItemId: string | null;
    readonly taskId: string | null;
  };
  readonly symptom: string;
  readonly evidence: {
    readonly availability: IncidentEvidenceAvailability;
    readonly reproductionRefs: readonly string[];
    readonly receiptRefs: readonly string[];
    readonly invariantRefs: readonly string[];
    readonly acceptanceRefs: readonly string[];
  };
  readonly publicSeam: string | null;
  readonly stateTransition: {
    readonly from: string | null;
    readonly to: string | null;
  };
  readonly observedFactors: readonly string[];
  readonly breadthHypotheses: IncidentLearningHypothesisSet;
  readonly depthHypotheses: IncidentLearningDepthHypothesisSet;
  readonly disposition: {
    readonly rootCauseHint: string | null;
    readonly familyHint: string | null;
    readonly recommendedAction: IncidentLearningRecommendedAction;
    readonly unknowns: readonly string[];
  };
  readonly authorityLimits: {
    readonly cannotAuthorizeMerge: true;
    readonly cannotDeclareFixSuccess: true;
    readonly cannotExcludeTests: true;
    readonly cannotCloseTask: true;
    readonly doesNotCreateSecondBacklog: true;
  };
}

export function createIncidentLearningCandidate(input: IncidentLearningCandidateInput): IncidentLearningCandidate {
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

export function deriveBreadthHypotheses(input: {
  readonly publicSeam: string | null;
  readonly stateFrom: string | null;
  readonly stateTo: string | null;
  readonly invariantRefs: readonly string[];
}): IncidentLearningHypothesisSet {
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

export function deriveDepthHypotheses(input: {
  readonly publicSeam: string | null;
  readonly stateFrom: string | null;
  readonly stateTo: string | null;
}): IncidentLearningDepthHypothesisSet {
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

function classifyEvidenceAvailability(input: {
  readonly reproductionRefs: readonly string[];
  readonly receiptRefs: readonly string[];
  readonly unknowns: readonly string[];
}): IncidentEvidenceAvailability {
  if (input.unknowns.some((unknown) => unknown.includes('conflicting'))) return 'conflicting';
  if (input.reproductionRefs.length === 0 && input.receiptRefs.length === 0) return 'unavailable';
  if (input.unknowns.length > 0) return 'partial';
  return 'available';
}

function collectUnknowns(input: {
  readonly symptom: string;
  readonly reproductionRefs: readonly string[];
  readonly receiptRefs: readonly string[];
  readonly invariantRefs: readonly string[];
  readonly acceptanceRefs: readonly string[];
  readonly publicSeam: string | null;
  readonly stateFrom: string | null;
  readonly stateTo: string | null;
  readonly observedFactors: readonly string[];
}): readonly string[] {
  const unknowns: string[] = [];
  if (!input.symptom) unknowns.push('symptom unavailable');
  if (input.reproductionRefs.length === 0) unknowns.push('reproduction refs unavailable');
  if (input.receiptRefs.length === 0) unknowns.push('receipt refs unavailable');
  if (input.invariantRefs.length === 0) unknowns.push('invariant refs unavailable');
  if (input.acceptanceRefs.length === 0) unknowns.push('acceptance refs unavailable');
  if (!input.publicSeam) unknowns.push('public seam unavailable');
  if (!input.stateFrom || !input.stateTo) unknowns.push('state transition unavailable');
  if (input.observedFactors.length === 0) unknowns.push('observed factors unavailable');
  return unknowns;
}

function normalizeNullable(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

function uniqueNonEmpty(values: readonly string[] | undefined): readonly string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
}

function formatTransition(from: string | null, to: string | null): string {
  return `${from ?? 'unknown'} -> ${to ?? 'unknown'}`;
}

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

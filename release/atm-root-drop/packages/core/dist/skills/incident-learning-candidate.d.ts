export declare const INCIDENT_LEARNING_CANDIDATE_SCHEMA_ID: "atm.incidentLearningCandidate.v1";
export type IncidentEvidenceAvailability = 'available' | 'partial' | 'unavailable' | 'conflicting';
export type IncidentLearningRecommendedAction = 'open-task-card' | 'attach-to-existing-task' | 'record-only' | 'needs-more-evidence';
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
export declare function createIncidentLearningCandidate(input: IncidentLearningCandidateInput): IncidentLearningCandidate;
export declare function deriveBreadthHypotheses(input: {
    readonly publicSeam: string | null;
    readonly stateFrom: string | null;
    readonly stateTo: string | null;
    readonly invariantRefs: readonly string[];
}): IncidentLearningHypothesisSet;
export declare function deriveDepthHypotheses(input: {
    readonly publicSeam: string | null;
    readonly stateFrom: string | null;
    readonly stateTo: string | null;
}): IncidentLearningDepthHypothesisSet;

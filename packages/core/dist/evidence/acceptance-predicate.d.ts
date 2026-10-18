import { type EvidenceRealness, type EvidenceRealnessObservation } from './realness.js';
export type AcceptancePredicateVerdict = 'pass' | 'fail' | 'inconclusive';
export interface AcceptanceVerifierContract {
    readonly mode: 'separate-actor' | 'locked-policy';
    readonly actorId?: string | null;
    readonly policyDigest?: string | null;
}
export interface AcceptanceNegativeControlContract {
    readonly id: string;
    readonly expectedFailureReason: string;
}
export interface AcceptanceEvidencePredicate {
    readonly id: string;
    readonly claim: string;
    readonly authoritativeSources: readonly string[];
    readonly derivationRule: string;
    readonly requiredRealness: EvidenceRealness;
    readonly verifier: AcceptanceVerifierContract;
    readonly negativeControls: readonly AcceptanceNegativeControlContract[];
    readonly missingDataVerdict: 'inconclusive';
    readonly closureCritical: boolean;
}
export type AcceptanceEvidenceMap = Readonly<Record<string, AcceptanceEvidencePredicate>>;
export interface AcceptancePredicateObservation {
    readonly authoritativeSourceRefs: readonly string[];
    readonly derivation: {
        readonly rule: string;
        readonly status: 'pass' | 'fail' | 'unavailable';
        readonly claimSatisfied: boolean | null;
    };
    readonly realness: EvidenceRealnessObservation;
    readonly verifier: {
        readonly mode: 'separate-actor' | 'locked-policy';
        readonly verified: boolean;
        readonly producerActorId?: string | null;
        readonly verifierActorId?: string | null;
        readonly policyDigest?: string | null;
        readonly sealedBeforeEvidence?: boolean;
    };
    readonly negativeControls: readonly {
        readonly id: string;
        readonly outcome: 'rejected' | 'accepted' | 'unavailable';
        readonly reason: string;
    }[];
}
export interface AcceptancePredicateResult {
    readonly predicateId: string;
    readonly verdict: AcceptancePredicateVerdict;
    readonly closureReady: boolean;
    readonly verifiedRealness: EvidenceRealness | null;
    readonly reasons: readonly string[];
}
export interface AcceptanceEvidenceMapResult {
    readonly verdict: AcceptancePredicateVerdict;
    readonly closureReady: boolean;
    readonly results: readonly AcceptancePredicateResult[];
}
export declare function evaluateAcceptancePredicate(predicate: AcceptanceEvidencePredicate, observation: AcceptancePredicateObservation | null | undefined): AcceptancePredicateResult;
export declare function evaluateAcceptanceEvidenceMap(predicates: AcceptanceEvidenceMap, observations: Readonly<Record<string, AcceptancePredicateObservation | null | undefined>>): AcceptanceEvidenceMapResult;

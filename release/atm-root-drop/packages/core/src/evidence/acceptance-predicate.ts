import {
  assessEvidenceRealness,
  evidenceMeetsRequiredRealness,
  isEvidenceRealness,
  type EvidenceRealness,
  type EvidenceRealnessObservation
} from './realness.ts';

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

export function evaluateAcceptancePredicate(
  predicate: AcceptanceEvidencePredicate,
  observation: AcceptancePredicateObservation | null | undefined
): AcceptancePredicateResult {
  const reasons: string[] = [];
  if (!observation) {
    return result(predicate, 'inconclusive', null, ['missing-observation']);
  }
  if (!isEvidenceRealness(predicate.requiredRealness)) {
    return result(predicate, 'inconclusive', null, ['unknown-required-realness']);
  }

  const missingSources = predicate.authoritativeSources
    .filter((source) => !observation.authoritativeSourceRefs.includes(source));
  if (missingSources.length > 0) reasons.push(`missing-authoritative-sources:${missingSources.join(',')}`);

  if (observation.derivation.status === 'unavailable') reasons.push('derivation-unavailable');
  if (observation.derivation.rule !== predicate.derivationRule) reasons.push('derivation-rule-mismatch');
  if (observation.derivation.status === 'fail' || observation.derivation.claimSatisfied === false) {
    reasons.push('derived-claim-failed');
  }
  if (observation.derivation.claimSatisfied === null) reasons.push('derived-claim-missing');

  const realness = assessEvidenceRealness(observation.realness);
  if (!evidenceMeetsRequiredRealness(realness.verifiedRealness, predicate.requiredRealness)) {
    reasons.push(`realness-below-required:${realness.verifiedRealness ?? 'unverified'}<${predicate.requiredRealness}`);
  }

  reasons.push(...evaluateVerifier(predicate.verifier, observation.verifier));
  reasons.push(...evaluateNegativeControls(predicate.negativeControls, observation.negativeControls));

  // Missing or underivable evidence stays inconclusive; only observed rejection semantics fail.
  const hardFailure = reasons.some((reason) =>
    reason === 'negative-control-accepted'
    || reason === 'verifier-rejected'
  );
  if (hardFailure) return result(predicate, 'fail', realness.verifiedRealness, reasons);
  if (reasons.length > 0) return result(predicate, predicate.missingDataVerdict, realness.verifiedRealness, reasons);
  return result(predicate, 'pass', realness.verifiedRealness, []);
}

export function evaluateAcceptanceEvidenceMap(
  predicates: AcceptanceEvidenceMap,
  observations: Readonly<Record<string, AcceptancePredicateObservation | null | undefined>>
): AcceptanceEvidenceMapResult {
  const results = Object.keys(predicates)
    .sort()
    .map((key) => {
      const predicate = predicates[key];
      if (predicate.id !== key) {
        return result(predicate, 'inconclusive', null, ['predicate-map-key-mismatch']);
      }
      return evaluateAcceptancePredicate(predicate, observations[key]);
    });
  const closureCritical = results.filter((entry) => predicates[entry.predicateId]?.closureCritical !== false);
  const verdict: AcceptancePredicateVerdict = results.some((entry) => entry.verdict === 'fail')
    ? 'fail'
    : results.some((entry) => entry.verdict === 'inconclusive')
      ? 'inconclusive'
      : 'pass';
  return {
    verdict,
    closureReady: closureCritical.every((entry) => entry.closureReady),
    results
  };
}

function evaluateVerifier(
  contract: AcceptanceVerifierContract,
  observation: AcceptancePredicateObservation['verifier']
): string[] {
  if (contract.mode !== observation.mode) return ['verifier-mode-mismatch'];
  if (!observation.verified) return ['verifier-rejected'];
  if (contract.mode === 'separate-actor') {
    const producer = observation.producerActorId?.trim();
    const verifier = observation.verifierActorId?.trim();
    if (!producer || !verifier) return ['separate-actor-identity-missing'];
    if (producer === verifier) return ['producer-self-verification'];
    if (contract.actorId && contract.actorId !== verifier) return ['verifier-actor-mismatch'];
    return [];
  }
  if (!contract.policyDigest || contract.policyDigest !== observation.policyDigest) {
    return ['locked-policy-digest-mismatch'];
  }
  if (observation.sealedBeforeEvidence !== true) return ['locked-policy-not-presealed'];
  return [];
}

function evaluateNegativeControls(
  contracts: readonly AcceptanceNegativeControlContract[],
  observations: AcceptancePredicateObservation['negativeControls']
): string[] {
  const reasons: string[] = [];
  for (const contract of contracts) {
    const observation = observations.find((entry) => entry.id === contract.id);
    if (!observation || observation.outcome === 'unavailable') {
      reasons.push(`negative-control-missing:${contract.id}`);
      continue;
    }
    if (observation.outcome === 'accepted') {
      reasons.push('negative-control-accepted');
      continue;
    }
    if (observation.reason !== contract.expectedFailureReason) {
      reasons.push(`negative-control-reason-mismatch:${contract.id}`);
    }
  }
  return reasons;
}

function result(
  predicate: AcceptanceEvidencePredicate,
  verdict: AcceptancePredicateVerdict,
  verifiedRealness: EvidenceRealness | null,
  reasons: readonly string[]
): AcceptancePredicateResult {
  return {
    predicateId: predicate.id,
    verdict,
    closureReady: verdict === 'pass',
    verifiedRealness,
    reasons: [...new Set(reasons)]
  };
}

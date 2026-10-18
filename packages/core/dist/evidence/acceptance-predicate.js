import { assessEvidenceRealness, evidenceMeetsRequiredRealness, isEvidenceRealness } from './realness.js';
export function evaluateAcceptancePredicate(predicate, observation) {
    const reasons = [];
    if (!observation) {
        return result(predicate, 'inconclusive', null, ['missing-observation']);
    }
    if (!isEvidenceRealness(predicate.requiredRealness)) {
        return result(predicate, 'inconclusive', null, ['unknown-required-realness']);
    }
    const missingSources = predicate.authoritativeSources
        .filter((source) => !observation.authoritativeSourceRefs.includes(source));
    if (missingSources.length > 0)
        reasons.push(`missing-authoritative-sources:${missingSources.join(',')}`);
    if (observation.derivation.status === 'unavailable')
        reasons.push('derivation-unavailable');
    if (observation.derivation.rule !== predicate.derivationRule)
        reasons.push('derivation-rule-mismatch');
    if (observation.derivation.status === 'fail' || observation.derivation.claimSatisfied === false) {
        reasons.push('derived-claim-failed');
    }
    if (observation.derivation.claimSatisfied === null)
        reasons.push('derived-claim-missing');
    const realness = assessEvidenceRealness(observation.realness);
    if (!evidenceMeetsRequiredRealness(realness.verifiedRealness, predicate.requiredRealness)) {
        reasons.push(`realness-below-required:${realness.verifiedRealness ?? 'unverified'}<${predicate.requiredRealness}`);
    }
    reasons.push(...evaluateVerifier(predicate.verifier, observation.verifier));
    reasons.push(...evaluateNegativeControls(predicate.negativeControls, observation.negativeControls));
    // Missing or underivable evidence stays inconclusive; only observed rejection semantics fail.
    const hardFailure = reasons.some((reason) => reason === 'negative-control-accepted'
        || reason === 'verifier-rejected');
    if (hardFailure)
        return result(predicate, 'fail', realness.verifiedRealness, reasons);
    if (reasons.length > 0)
        return result(predicate, predicate.missingDataVerdict, realness.verifiedRealness, reasons);
    return result(predicate, 'pass', realness.verifiedRealness, []);
}
export function evaluateAcceptanceEvidenceMap(predicates, observations) {
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
    const verdict = results.some((entry) => entry.verdict === 'fail')
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
function evaluateVerifier(contract, observation) {
    if (contract.mode !== observation.mode)
        return ['verifier-mode-mismatch'];
    if (!observation.verified)
        return ['verifier-rejected'];
    if (contract.mode === 'separate-actor') {
        const producer = observation.producerActorId?.trim();
        const verifier = observation.verifierActorId?.trim();
        if (!producer || !verifier)
            return ['separate-actor-identity-missing'];
        if (producer === verifier)
            return ['producer-self-verification'];
        if (contract.actorId && contract.actorId !== verifier)
            return ['verifier-actor-mismatch'];
        return [];
    }
    if (!contract.policyDigest || contract.policyDigest !== observation.policyDigest) {
        return ['locked-policy-digest-mismatch'];
    }
    if (observation.sealedBeforeEvidence !== true)
        return ['locked-policy-not-presealed'];
    return [];
}
function evaluateNegativeControls(contracts, observations) {
    const reasons = [];
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
function result(predicate, verdict, verifiedRealness, reasons) {
    return {
        predicateId: predicate.id,
        verdict,
        closureReady: verdict === 'pass',
        verifiedRealness,
        reasons: [...new Set(reasons)]
    };
}

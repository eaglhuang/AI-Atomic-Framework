import assert from 'node:assert/strict';
import {
  compareEvidenceRealness,
  evaluateAcceptancePredicate,
  type AcceptanceEvidencePredicate,
  type AcceptancePredicateObservation
} from '../../packages/core/src/evidence/index.ts';

const digest = `sha256:${'a'.repeat(64)}`;

const predicate: AcceptanceEvidencePredicate = {
  id: 'parallel-run-is-real',
  claim: 'Two distinct workers completed governed work in parallel.',
  authoritativeSources: ['broker-events', 'task-events'],
  derivationRule: 'distinct-task-actor-process-tuples-overlap',
  requiredRealness: 'real-dogfood',
  verifier: { mode: 'separate-actor' },
  negativeControls: [{
    id: 'same-process-replay',
    expectedFailureReason: 'process-identity-not-distinct'
  }],
  missingDataVerdict: 'inconclusive',
  closureCritical: true
};

function realDogfoodObservation(): AcceptancePredicateObservation {
  return {
    authoritativeSourceRefs: ['broker-events', 'task-events'],
    derivation: {
      rule: predicate.derivationRule,
      status: 'pass',
      claimSatisfied: true
    },
    realness: {
      declaredRealness: 'real-dogfood',
      commandProof: {
        command: 'node atm.mjs team run --task ATM-GOV-0251 --json',
        exitCode: 0,
        stdoutDigest: digest,
        stderrDigest: digest
      },
      sealedScenarioDigest: digest,
      runnerDigest: digest,
      workloadDigest: digest,
      taskIds: ['ATM-GOV-0247', 'ATM-GOV-0251'],
      actorIds: ['worker-a', 'worker-b'],
      processIds: ['process-a', 'process-b'],
      canonicalEventRefs: ['canonical-event-1', 'canonical-event-2'],
      eventChainDigest: digest,
      taskIdentityDigests: [digest, `sha256:${'b'.repeat(64)}`],
      actorIdentityDigests: [digest, `sha256:${'c'.repeat(64)}`],
      processIdentityDigests: [digest, `sha256:${'d'.repeat(64)}`]
    },
    verifier: {
      mode: 'separate-actor',
      verified: true,
      producerActorId: 'worker-a',
      verifierActorId: 'captain'
    },
    negativeControls: [{
      id: 'same-process-replay',
      outcome: 'rejected',
      reason: 'process-identity-not-distinct'
    }]
  };
}

const valid = evaluateAcceptancePredicate(predicate, realDogfoodObservation());
assert.equal(valid.verdict, 'pass');
assert.equal(valid.closureReady, true);
assert.equal(valid.verifiedRealness, 'real-dogfood');

const missing = evaluateAcceptancePredicate(predicate, undefined);
assert.equal(missing.verdict, 'inconclusive');
assert.equal(missing.closureReady, false);

const forgedLabel = realDogfoodObservation();
const forgedResult = evaluateAcceptancePredicate(predicate, {
  ...forgedLabel,
  realness: {
    declaredRealness: 'real-dogfood',
    commandProof: {
      command: 'node atm.mjs --version',
      exitCode: 0,
      stdoutDigest: digest,
      stderrDigest: digest
    }
  }
});
assert.equal(forgedResult.verdict, 'inconclusive');
assert.equal(forgedResult.verifiedRealness, null);

const lowerTierSubstitution = evaluateAcceptancePredicate(predicate, {
  ...realDogfoodObservation(),
  realness: {
    declaredRealness: 'unit',
    commandProof: {
      command: 'node --strip-types tests/core/example.test.ts',
      exitCode: 0,
      stdoutDigest: digest,
      stderrDigest: digest
    },
    testId: 'example-unit'
  }
});
assert.equal(lowerTierSubstitution.verdict, 'inconclusive');
assert.equal(lowerTierSubstitution.verifiedRealness, 'command-smoke');

const negativeControlFailure = evaluateAcceptancePredicate(predicate, {
  ...realDogfoodObservation(),
  negativeControls: [{
    id: 'same-process-replay',
    outcome: 'accepted',
    reason: 'unexpected-pass'
  }]
});
assert.equal(negativeControlFailure.verdict, 'fail');

const fixedMetricFixture = evaluateAcceptancePredicate(predicate, {
  ...realDogfoodObservation(),
  realness: {
    ...realDogfoodObservation().realness,
    syntheticSignals: ['fixed-pid', 'fixed-timing', 'fixed-cost']
  }
});
assert.equal(fixedMetricFixture.verdict, 'inconclusive');
assert.equal(fixedMetricFixture.verifiedRealness, 'sealed-replay');

const failedDerivation = evaluateAcceptancePredicate(predicate, {
  ...realDogfoodObservation(),
  derivation: {
    rule: predicate.derivationRule,
    status: 'fail',
    claimSatisfied: false
  }
});
assert.equal(failedDerivation.verdict, 'inconclusive');

const selfVerified = evaluateAcceptancePredicate(predicate, {
  ...realDogfoodObservation(),
  verifier: {
    mode: 'separate-actor',
    verified: true,
    producerActorId: 'worker-a',
    verifierActorId: 'worker-a'
  }
});
assert.equal(selfVerified.verdict, 'inconclusive');
assert.ok(selfVerified.reasons.includes('producer-self-verification'));

assert.ok(compareEvidenceRealness('unit', 'fixture') > 0);
assert.ok(compareEvidenceRealness('sealed-replay', 'real-dogfood') < 0);

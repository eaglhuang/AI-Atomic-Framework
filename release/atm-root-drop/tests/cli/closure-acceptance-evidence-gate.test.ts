import assert from 'node:assert/strict';
import { assertAcceptanceEvidenceClosureGate, evaluateAcceptanceEvidenceClosureGate } from '../../packages/cli/src/commands/tasks/close-orchestrator/acceptance-evidence-gate.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const stdoutDigest = `sha256:${'b'.repeat(64)}`;
const stderrDigest = `sha256:${'c'.repeat(64)}`;

function predicate(verifier: Record<string, unknown> = { mode: 'locked-policy', policyDigest: digest }) {
  return {
    id: 'real-close-proof',
    claim: 'closure uses command-backed independent evidence',
    authoritativeSources: ['evidence:closure'],
    derivationRule: 'derive-from-command-receipt',
    requiredRealness: 'command-smoke',
    verifier,
    negativeControls: [{ id: 'forged-label', expectedFailureReason: 'caller-label-rejected' }],
    missingDataVerdict: 'inconclusive',
    closureCritical: true
  };
}

function passingObservation(verifier: Record<string, unknown> = {
  mode: 'locked-policy',
  verified: true,
  policyDigest: digest,
  sealedBeforeEvidence: true
}) {
  return {
    authoritativeSourceRefs: ['evidence:closure'],
    derivation: {
      rule: 'derive-from-command-receipt',
      status: 'pass',
      claimSatisfied: true
    },
    realness: {
      declaredRealness: 'command-smoke',
      commandProof: {
        command: 'node --strip-types tests/cli/example.test.ts',
        exitCode: 0,
        stdoutDigest,
        stderrDigest
      }
    },
    verifier,
    negativeControls: [{ id: 'forged-label', outcome: 'rejected', reason: 'caller-label-rejected' }]
  };
}

assert.equal(
  evaluateAcceptanceEvidenceClosureGate({ taskDocument: {} }).status,
  'not-required',
  'legacy task cards without acceptanceEvidence must remain backward compatible'
);

const missingObservation = evaluateAcceptanceEvidenceClosureGate({
  taskDocument: { acceptanceEvidence: { 'real-close-proof': predicate() } }
});
assert.equal(missingObservation.status, 'blocked');
assert.equal(missingObservation.blockers[0]?.code, 'ATM_TASK_CLOSE_ACCEPTANCE_EVIDENCE_INSUFFICIENT');

const sameActor = evaluateAcceptanceEvidenceClosureGate({
  taskDocument: {
    acceptanceEvidence: {
      'real-close-proof': predicate({ mode: 'separate-actor', actorId: 'reviewer' })
    },
    acceptanceEvidenceObservations: {
      'real-close-proof': passingObservation({
        mode: 'separate-actor',
        verified: true,
        producerActorId: 'worker',
        verifierActorId: 'worker'
      })
    }
  }
});
assert.equal(sameActor.status, 'blocked');
assert.equal(sameActor.blockers[0]?.code, 'ATM_TASK_CLOSE_INDEPENDENT_VERIFIER_REQUIRED');

const lockedPolicy = evaluateAcceptanceEvidenceClosureGate({
  taskDocument: {
    acceptanceEvidence: { 'real-close-proof': predicate() },
    acceptanceEvidenceObservations: { 'real-close-proof': passingObservation() }
  }
});
assert.equal(lockedPolicy.status, 'pass');

const separateActor = evaluateAcceptanceEvidenceClosureGate({
  taskDocument: {
    acceptanceEvidence: {
      'real-close-proof': predicate({ mode: 'separate-actor', actorId: 'reviewer' })
    },
    acceptanceEvidenceObservations: {
      'real-close-proof': passingObservation({
        mode: 'separate-actor',
        verified: true,
        producerActorId: 'worker',
        verifierActorId: 'reviewer'
      })
    }
  }
});
assert.equal(separateActor.status, 'pass');

assert.throws(
  () => assertAcceptanceEvidenceClosureGate({
    taskId: 'TASK-EXAMPLE',
    taskDocument: { acceptanceEvidence: { 'real-close-proof': predicate() } }
  }),
  /closure-critical acceptance evidence/
);

console.log('[closure-acceptance-evidence-gate:test] ok');

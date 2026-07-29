import assert from 'node:assert/strict';
import {
  assertRunnerExecutionAttestationDigest,
  buildRunnerExecutionAttestation
} from '../../packages/core/src/broker/runner-execution-attestation.ts';

const attestation = buildRunnerExecutionAttestation({
  taskId: 'ATM-GOV-0268',
  selectedRunnerReceiptDigest: 'sha256:' + '1'.repeat(64),
  frozenEntrypointDigest: 'sha256:' + '2'.repeat(64),
  frozenOutputDigests: ['sha256:' + '4'.repeat(64), 'sha256:' + '3'.repeat(64)],
  taskChangeDigest: 'sha256:' + '5'.repeat(64),
  commandBackedValidators: [
    { command: 'npm run typecheck', exitCode: 0, stdoutSha256: 'sha256:' + '6'.repeat(64), stderrSha256: 'sha256:' + '7'.repeat(64) },
    { command: 'node --strip-types tests/core/x.test.ts', exitCode: 0, stdoutSha256: 'sha256:' + '8'.repeat(64), stderrSha256: 'sha256:' + '9'.repeat(64) }
  ],
  runnerTransition: null,
  generatedAt: '2026-07-29T01:00:00.000Z'
});

const reordered = buildRunnerExecutionAttestation({
  ...attestation,
  frozenOutputDigests: [...attestation.frozenOutputDigests].reverse(),
  commandBackedValidators: [...attestation.commandBackedValidators].reverse()
});

assert.equal(reordered.attestationDigest, attestation.attestationDigest);
assert.equal(assertRunnerExecutionAttestationDigest(JSON.parse(JSON.stringify(attestation))).attestationDigest, attestation.attestationDigest);
assert.throws(
  () => assertRunnerExecutionAttestationDigest({ ...attestation, taskChangeDigest: 'sha256:' + 'a'.repeat(64) }),
  /digest mismatch/i
);

console.log('runner-execution-attestation.test.ts: 3 cases passed');

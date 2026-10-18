import { digestCanonicalJson } from './runner-registry-snapshot.js';
export const RUNNER_EXECUTION_ATTESTATION_SCHEMA = 'atm.runnerExecutionAttestation.v1';
export function buildRunnerExecutionAttestation(input) {
    const core = {
        schemaId: RUNNER_EXECUTION_ATTESTATION_SCHEMA,
        specVersion: '0.1.0',
        taskId: input.taskId,
        selectedRunnerReceiptDigest: input.selectedRunnerReceiptDigest,
        frozenEntrypointDigest: input.frozenEntrypointDigest,
        frozenOutputDigests: [...input.frozenOutputDigests].sort((a, b) => a.localeCompare(b)),
        taskChangeDigest: input.taskChangeDigest,
        commandBackedValidators: [...input.commandBackedValidators].sort((a, b) => a.command.localeCompare(b.command)),
        runnerTransition: input.runnerTransition,
        generatedAt: input.generatedAt
    };
    return { ...core, attestationDigest: digestCanonicalJson(core) };
}
export function assertRunnerExecutionAttestationDigest(attestation) {
    const rebuilt = buildRunnerExecutionAttestation(attestation);
    if (rebuilt.attestationDigest !== attestation.attestationDigest) {
        throw new Error(`Runner execution attestation digest mismatch: expected ${attestation.attestationDigest}, got ${rebuilt.attestationDigest}`);
    }
    return rebuilt;
}

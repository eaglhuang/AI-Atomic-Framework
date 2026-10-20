export declare const RUNNER_EXECUTION_ATTESTATION_SCHEMA: "atm.runnerExecutionAttestation.v1";
export interface RunnerCommandBackedValidatorResult {
    readonly command: string;
    readonly exitCode: number;
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
}
export interface RunnerExecutionAttestation {
    readonly schemaId: typeof RUNNER_EXECUTION_ATTESTATION_SCHEMA;
    readonly specVersion: '0.1.0';
    readonly taskId: string;
    readonly selectedRunnerReceiptDigest: string;
    readonly frozenEntrypointDigest: string;
    readonly frozenOutputDigests: readonly string[];
    readonly taskChangeDigest: string;
    readonly commandBackedValidators: readonly RunnerCommandBackedValidatorResult[];
    readonly runnerTransition: string | null;
    readonly generatedAt: string;
    readonly attestationDigest: string;
}
export declare function buildRunnerExecutionAttestation(input: Omit<RunnerExecutionAttestation, 'schemaId' | 'specVersion' | 'attestationDigest'>): RunnerExecutionAttestation;
export declare function assertRunnerExecutionAttestationDigest(attestation: RunnerExecutionAttestation): RunnerExecutionAttestation;

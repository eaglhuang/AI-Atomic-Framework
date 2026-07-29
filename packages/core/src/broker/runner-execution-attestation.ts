import { digestCanonicalJson } from './runner-registry-snapshot.ts';

export const RUNNER_EXECUTION_ATTESTATION_SCHEMA = 'atm.runnerExecutionAttestation.v1' as const;

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

export function buildRunnerExecutionAttestation(input: Omit<RunnerExecutionAttestation, 'schemaId' | 'specVersion' | 'attestationDigest'>): RunnerExecutionAttestation {
  const core = {
    schemaId: RUNNER_EXECUTION_ATTESTATION_SCHEMA,
    specVersion: '0.1.0' as const,
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

export function assertRunnerExecutionAttestationDigest(attestation: RunnerExecutionAttestation): RunnerExecutionAttestation {
  const rebuilt = buildRunnerExecutionAttestation(attestation);
  if (rebuilt.attestationDigest !== attestation.attestationDigest) {
    throw new Error(`Runner execution attestation digest mismatch: expected ${attestation.attestationDigest}, got ${rebuilt.attestationDigest}`);
  }
  return rebuilt;
}

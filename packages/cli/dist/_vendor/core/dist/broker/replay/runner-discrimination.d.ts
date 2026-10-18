export type RunnerRole = 'historical' | 'current';
export type RunnerProbeVerdict = 'red' | 'green' | 'unavailable';
export type RedGreenDiscriminationVerdict = 'red-green' | 'inconclusive';
export interface SealedRunnerIdentity {
    readonly schemaId: 'atm.sealedRunnerIdentity.v1';
    readonly role: RunnerRole;
    readonly entrypoint: string;
    readonly digest: string;
    readonly commitSha: string | null;
    readonly available: boolean;
}
export interface DiscriminationScenarioSeal {
    readonly schemaId: 'atm.runnerDiscriminationScenario.v1';
    readonly specVersion: '0.1.0';
    readonly scenarioId: string;
    readonly probeArgv: readonly string[];
    readonly assertionDigest: string;
    readonly thresholdDigest: string;
    readonly coverageDigest: string;
    readonly workloadDigest: string;
    /** Digest over scenario fields only — never includes runner digests. */
    readonly scenarioDigest: string;
}
export interface DiscriminationScenarioInput {
    readonly scenarioId: string;
    readonly probeArgv: readonly string[];
    readonly assertion: unknown;
    readonly thresholds: unknown;
    readonly coverage: unknown;
    readonly workload: unknown;
}
export interface RunnerProbeReceipt {
    readonly schemaId: 'atm.runnerProbeReceipt.v1';
    readonly role: RunnerRole;
    readonly runner: SealedRunnerIdentity;
    readonly scenarioDigest: string;
    readonly command: string;
    readonly exitCode: number | null;
    readonly stdoutDigest: string;
    readonly stderrDigest: string;
    readonly executed: boolean;
    /** Counters derived from command output / event-state diffs only. */
    readonly counters: Readonly<Record<string, number>>;
    readonly verdict: RunnerProbeVerdict;
    readonly reason: string;
}
export interface RedGreenDiscriminationSummary {
    readonly schemaId: 'atm.runnerRedGreenDiscriminationSummary.v1';
    readonly specVersion: '0.1.0';
    readonly generatedAt: string;
    readonly scenario: DiscriminationScenarioSeal;
    readonly historical: RunnerProbeReceipt;
    readonly current: RunnerProbeReceipt;
    readonly discrimination: RedGreenDiscriminationVerdict;
    readonly reason: string;
    readonly digest: string;
}
export declare function sealRunnerIdentity(input: {
    readonly role: RunnerRole;
    readonly entrypoint: string;
    readonly contentDigest: string;
    readonly commitSha?: string | null;
    readonly available: boolean;
}): SealedRunnerIdentity;
export declare function digestRunnerContent(content: string | Uint8Array): string;
export declare function sealDiscriminationScenario(input: DiscriminationScenarioInput): DiscriminationScenarioSeal;
/**
 * Derive failure/success counters from probe command output and optional
 * event/state diffs. Fixture-declared failureShapes are intentionally ignored.
 */
export declare function deriveProbeCounters(input: {
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly eventStateDiff?: Readonly<Record<string, number>>;
}): Readonly<Record<string, number>>;
export declare function classifyProbeVerdict(input: {
    readonly executed: boolean;
    readonly runnerAvailable: boolean;
    readonly exitCode: number | null;
    readonly counters: Readonly<Record<string, number>>;
}): {
    readonly verdict: RunnerProbeVerdict;
    readonly reason: string;
};
export declare function buildRunnerProbeReceipt(input: {
    readonly role: RunnerRole;
    readonly runner: SealedRunnerIdentity;
    readonly scenarioDigest: string;
    readonly command: string;
    readonly exitCode: number | null;
    readonly stdout: string;
    readonly stderr: string;
    readonly executed: boolean;
    readonly eventStateDiff?: Readonly<Record<string, number>>;
}): RunnerProbeReceipt;
export declare function evaluateRedGreenDiscrimination(input: {
    readonly scenario: DiscriminationScenarioSeal;
    readonly historical: RunnerProbeReceipt;
    readonly current: RunnerProbeReceipt;
    readonly generatedAt?: string;
}): RedGreenDiscriminationSummary;
export declare function validateRedGreenDiscriminationSummary(summary: unknown): string[];

import { type PublishedRunnerVersion, type RunnerVersionRegistry } from './runner-version-registry.js';
export declare const RUNNER_REGISTRY_SNAPSHOT_SCHEMA: "atm.runnerRegistrySnapshot.v1";
export interface RunnerRegistrySnapshot {
    readonly schemaId: typeof RUNNER_REGISTRY_SNAPSHOT_SCHEMA;
    readonly specVersion: '0.1.0';
    readonly generatedAt: string;
    readonly policyVersion: string;
    readonly versions: readonly PublishedRunnerVersion[];
    readonly snapshotDigest: string;
}
export interface RunnerRegistrySnapshotSource {
    readSnapshot(): RunnerRegistrySnapshot;
}
export declare function buildRunnerRegistrySnapshot(input: {
    readonly versions: readonly PublishedRunnerVersion[];
    readonly generatedAt: string;
    readonly policyVersion: string;
}): RunnerRegistrySnapshot;
export declare function readRunnerRegistrySnapshotValue(snapshot: RunnerRegistrySnapshot): RunnerRegistrySnapshot;
export declare function createRegistryFromSnapshot(snapshot: RunnerRegistrySnapshot): RunnerVersionRegistry;
export declare function digestCanonicalJson(value: unknown): string;

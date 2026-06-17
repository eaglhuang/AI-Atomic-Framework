import type { MigrationRecord } from './types.ts';
export declare const RUNNER_REF_STORE_SCHEMA_ID: "atm.runnerRefStore.v1";
export declare const RUNNER_REF_STORE_SPEC_VERSION: "0.1.0";
export type RunnerRefKind = 'version' | 'control';
export interface RunnerRefEntry {
    readonly refName: string;
    readonly kind: RunnerRefKind;
    readonly sourceCommit: string;
    readonly artifactSha256: string;
    readonly publisherActorId: string;
    readonly publishedAt: string;
    /** Optional reproducibility proof reference (TASK-MAO-0011). */
    readonly reproducibilityProofRef?: string | null;
}
export interface RunnerRefStore {
    readonly schemaId: typeof RUNNER_REF_STORE_SCHEMA_ID;
    readonly specVersion: typeof RUNNER_REF_STORE_SPEC_VERSION;
    readonly migration: MigrationRecord;
    readonly entries: readonly RunnerRefEntry[];
}
export declare function createEmptyRunnerRefStore(): RunnerRefStore;
export interface PublishRunnerRefInput {
    readonly refName: string;
    readonly kind: RunnerRefKind;
    readonly sourceCommit: string;
    readonly artifactSha256: string;
    readonly publisherActorId: string;
    readonly publishedAt?: string;
    readonly reproducibilityProofRef?: string | null;
}
export interface PublishRunnerRefResult {
    readonly ok: boolean;
    readonly reason: string;
    readonly store: RunnerRefStore;
    readonly entry: RunnerRefEntry | null;
}
/**
 * Append a publish ref. Version refs are immutable: re-publishing the same
 * refName as version kind fails closed. Control refs may be moved by appending
 * a newer entry; the resolver below treats the latest entry per (refName, kind)
 * as authoritative.
 */
export declare function publishRunnerRef(store: RunnerRefStore, input: PublishRunnerRefInput): PublishRunnerRefResult;
/** Resolve the current value of a named ref. Latest entry per (refName, kind) wins. */
export declare function resolveRunnerRef(store: RunnerRefStore, refName: string, kind?: RunnerRefKind): RunnerRefEntry | null;

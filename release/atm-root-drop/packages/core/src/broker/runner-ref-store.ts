// TASK-MAO-0014: runner-ref publish primitive. A small append-only ledger of
// publish refs for ATM core runner versions, used by the Runner Sync Steward
// (TASK-MAO-0013) to record which (sourceCommit, artifactSha256) pairs have
// been published. Each entry is signed by the publisher actor id; immutable
// version refs are recorded here, while moving control refs (e.g. in-dev/HEAD)
// are tracked separately by the version state machine (TASK-MAO-0017).
import type { MigrationRecord } from './types.ts';

export const RUNNER_REF_STORE_SCHEMA_ID = 'atm.runnerRefStore.v1' as const;
export const RUNNER_REF_STORE_SPEC_VERSION = '0.1.0' as const;

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

export function createEmptyRunnerRefStore(): RunnerRefStore {
  return {
    schemaId: RUNNER_REF_STORE_SCHEMA_ID,
    specVersion: RUNNER_REF_STORE_SPEC_VERSION,
    migration: { strategy: 'none', fromVersion: null, notes: 'Runner ref store baseline.' },
    entries: []
  };
}

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
export function publishRunnerRef(
  store: RunnerRefStore,
  input: PublishRunnerRefInput
): PublishRunnerRefResult {
  if (!input.refName.trim()) {
    return { ok: false, reason: 'refName is required', store, entry: null };
  }
  if (!input.sourceCommit.trim()) {
    return { ok: false, reason: 'sourceCommit is required', store, entry: null };
  }
  if (!input.artifactSha256.trim()) {
    return { ok: false, reason: 'artifactSha256 is required', store, entry: null };
  }
  if (!input.publisherActorId.trim()) {
    return { ok: false, reason: 'publisherActorId is required', store, entry: null };
  }

  if (input.kind === 'version') {
    const prior = store.entries.find(
      (e) => e.refName === input.refName && e.kind === 'version'
    );
    if (prior) {
      return {
        ok: false,
        reason: `version ref ${input.refName} is immutable and was already published at ${prior.publishedAt}`,
        store,
        entry: null
      };
    }
  }

  const entry: RunnerRefEntry = {
    refName: input.refName,
    kind: input.kind,
    sourceCommit: input.sourceCommit,
    artifactSha256: input.artifactSha256,
    publisherActorId: input.publisherActorId,
    publishedAt: input.publishedAt ?? new Date().toISOString(),
    reproducibilityProofRef: input.reproducibilityProofRef ?? null
  };

  return {
    ok: true,
    reason: 'ref appended',
    store: { ...store, entries: [...store.entries, entry] },
    entry
  };
}

/** Resolve the current value of a named ref. Latest entry per (refName, kind) wins. */
export function resolveRunnerRef(
  store: RunnerRefStore,
  refName: string,
  kind: RunnerRefKind = 'version'
): RunnerRefEntry | null {
  for (let i = store.entries.length - 1; i >= 0; i -= 1) {
    const e = store.entries[i];
    if (e.refName === refName && e.kind === kind) return e;
  }
  return null;
}

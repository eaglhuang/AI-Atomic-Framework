export const RUNNER_REF_STORE_SCHEMA_ID = 'atm.runnerRefStore.v1';
export const RUNNER_REF_STORE_SPEC_VERSION = '0.1.0';
export function createEmptyRunnerRefStore() {
    return {
        schemaId: RUNNER_REF_STORE_SCHEMA_ID,
        specVersion: RUNNER_REF_STORE_SPEC_VERSION,
        migration: { strategy: 'none', fromVersion: null, notes: 'Runner ref store baseline.' },
        entries: []
    };
}
/**
 * Append a publish ref. Version refs are immutable: re-publishing the same
 * refName as version kind fails closed. Control refs may be moved by appending
 * a newer entry; the resolver below treats the latest entry per (refName, kind)
 * as authoritative.
 */
export function publishRunnerRef(store, input) {
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
        const prior = store.entries.find((e) => e.refName === input.refName && e.kind === 'version');
        if (prior) {
            return {
                ok: false,
                reason: `version ref ${input.refName} is immutable and was already published at ${prior.publishedAt}`,
                store,
                entry: null
            };
        }
    }
    const entry = {
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
export function resolveRunnerRef(store, refName, kind = 'version') {
    for (let i = store.entries.length - 1; i >= 0; i -= 1) {
        const e = store.entries[i];
        if (e.refName === refName && e.kind === kind)
            return e;
    }
    return null;
}

import { type FileDescriptor, type FileMutationAdapter } from '../types.ts';
/**
 * An ordered list of format adapters plus a guaranteed fallback. `resolveAdapter`
 * walks `adapters` in order and returns the first whose `supports()` is true;
 * if none match, the fallback (always last, always matches) wins.
 */
export interface AdapterRegistry {
    readonly adapters: readonly FileMutationAdapter[];
    readonly fallback: FileMutationAdapter;
}
/**
 * Creates a registry from an explicit ordered adapter list. The fallback is
 * always the supplied fallback (default: fallbackFileLockAdapter) and is never
 * part of the ordered `adapters` list — it is consulted last by resolveAdapter.
 */
export declare function createAdapterRegistry(adapters?: readonly FileMutationAdapter[], fallback?: FileMutationAdapter): AdapterRegistry;
/**
 * Returns a new registry with `adapter` registered. Registration dedupes by id
 * (a later registration with the same id replaces the earlier one, keeping its
 * position) and never displaces the fallback, which always stays last.
 */
export declare function registerAdapter(registry: AdapterRegistry, adapter: FileMutationAdapter): AdapterRegistry;
/**
 * Resolves the adapter that owns a file. Walks the ordered adapter list; first
 * `supports()===true` wins; the fallback is returned if nothing else matches.
 */
export declare function resolveAdapter(registry: AdapterRegistry, file: FileDescriptor): FileMutationAdapter;
/**
 * The default adapter registry used by the broker write path.
 *
 * Order (most specific first): numeric-scalar -> text-range -> atom-map ->
 * json-record, with the fallback file-lock adapter always consulted last.
 * numeric-scalar is listed before json-record because its `*.scalars.json` /
 * `*.counter.json` files also end in `.json` and must not be shadowed by the
 * generic adapter. The path-to-atom-map domain adapter (TASK-CID-0094) sits
 * before json-record since owner-shard files are also `.json` and need its
 * row-identity conflict-key scheme rather than the generic JSON-pointer one.
 */
export declare function defaultAdapterRegistry(): AdapterRegistry;
export declare const defaultFallbackAdapterId = "fallback-file-lock";

import { type FileDescriptor, type FileMutationAdapter } from '../types.ts';
import { FALLBACK_ADAPTER_ID, fallbackFileLockAdapter } from './fallback-file-lock.ts';
import { jsonRecordAdapter } from './json-record.ts';
import { pathToAtomMapAdapter } from './atom-map.ts';
import { textRangeAdapter } from './text-range.ts';
import { numericScalarAdapter } from './numeric-scalar.ts';

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
export function createAdapterRegistry(
  adapters: readonly FileMutationAdapter[] = [],
  fallback: FileMutationAdapter = fallbackFileLockAdapter
): AdapterRegistry {
  return { adapters: dedupeById(adapters, fallback.id), fallback };
}

/**
 * Returns a new registry with `adapter` registered. Registration dedupes by id
 * (a later registration with the same id replaces the earlier one, keeping its
 * position) and never displaces the fallback, which always stays last.
 */
export function registerAdapter(registry: AdapterRegistry, adapter: FileMutationAdapter): AdapterRegistry {
  if (adapter.id === registry.fallback.id) {
    return { adapters: registry.adapters, fallback: adapter };
  }
  const existingIndex = registry.adapters.findIndex((entry) => entry.id === adapter.id);
  if (existingIndex >= 0) {
    const next = [...registry.adapters];
    next[existingIndex] = adapter;
    return { adapters: next, fallback: registry.fallback };
  }
  return { adapters: [...registry.adapters, adapter], fallback: registry.fallback };
}

/**
 * Resolves the adapter that owns a file. Walks the ordered adapter list; first
 * `supports()===true` wins; the fallback is returned if nothing else matches.
 */
export function resolveAdapter(registry: AdapterRegistry, file: FileDescriptor): FileMutationAdapter {
  for (const adapter of registry.adapters) {
    if (adapter.supports(file)) {
      return adapter;
    }
  }
  return registry.fallback;
}

function dedupeById(adapters: readonly FileMutationAdapter[], fallbackId: string): readonly FileMutationAdapter[] {
  const seen = new Map<string, number>();
  const result: FileMutationAdapter[] = [];
  for (const adapter of adapters) {
    if (adapter.id === fallbackId) {
      continue;
    }
    const existingIndex = seen.get(adapter.id);
    if (existingIndex !== undefined) {
      result[existingIndex] = adapter;
      continue;
    }
    seen.set(adapter.id, result.length);
    result.push(adapter);
  }
  return result;
}

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
export function defaultAdapterRegistry(): AdapterRegistry {
  return createAdapterRegistry(
    [
      numericScalarAdapter,
      textRangeAdapter,
      pathToAtomMapAdapter,
      jsonRecordAdapter
    ],
    fallbackFileLockAdapter
  );
}

export const defaultFallbackAdapterId = FALLBACK_ADAPTER_ID;

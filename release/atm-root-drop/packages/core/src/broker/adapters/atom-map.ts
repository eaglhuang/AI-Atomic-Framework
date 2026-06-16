import {
  brokerAdapterMigration,
  type ConflictKey,
  type FileDescriptor,
  type FileMutationAdapter,
  type MergeDecision,
  type MutationRequest,
  type NormalizedMutation,
  type ParsedDocument,
  type ValidationResult
} from '../types.ts';
import { jsonRecordAdapter } from './json-record.ts';

export const ATOM_MAP_ADAPTER_ID = 'path-to-atom-map';

/**
 * Metadata-level (non-row) fields of a path-to-atom-map owner shard. A mutation
 * touching any of these widens its conflict key to the whole shard file, since
 * editing shard metadata cannot be safely composed with concurrent row edits.
 */
const METADATA_TARGETS: ReadonlySet<string> = new Set([
  'schemaId',
  'schemaSource',
  'version',
  'timestamp',
  'sharding',
  'summary',
  'owner'
]);

/**
 * Parses a mutation target that addresses a mappings[] row. The target encodes
 * the row identity as `${path_pattern}::${atom_id}` (option A: identity key,
 * stable across field edits). Returns null when the target is not a row target.
 */
function parseRowTarget(target: string): { pathPattern: string; atomId: string } | null {
  const trimmed = target.replace(/^mappings\//, '').replace(/^\//, '');
  const separatorIndex = trimmed.indexOf('::');
  if (separatorIndex < 0) {
    return null;
  }
  const pathPattern = trimmed.slice(0, separatorIndex);
  const atomId = trimmed.slice(separatorIndex + 2);
  if (pathPattern.length === 0 || atomId.length === 0) {
    return null;
  }
  return { pathPattern, atomId };
}

function topLevelTarget(target: string): string {
  const normalized = target.replace(/^\//, '');
  const slashIndex = normalized.indexOf('/');
  return slashIndex >= 0 ? normalized.slice(0, slashIndex) : normalized;
}

/** Row identity conflict key (LOCKED option A): record:${path_pattern}::${atom_id}. */
function rowConflictKey(pathPattern: string, atomId: string): ConflictKey {
  return {
    schemaId: 'atm.conflictKey.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    scope: 'record',
    key: `record:${pathPattern}::${atomId}`
  };
}

/** Whole-shard conflict key for metadata-level mutations. */
function shardFileConflictKey(shardPath: string): ConflictKey {
  return {
    schemaId: 'atm.conflictKey.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    scope: 'file',
    key: shardPath
  };
}

/**
 * Computes the conflict key(s) for a single atom-map mutation. Row mutations get
 * a stable identity key; metadata mutations widen to the whole shard file so they
 * serialize against any row mutation in the same shard.
 */
function conflictKeyFor(mutation: NormalizedMutation): ConflictKey {
  const row = parseRowTarget(mutation.target);
  if (row) {
    return rowConflictKey(row.pathPattern, row.atomId);
  }
  if (METADATA_TARGETS.has(topLevelTarget(mutation.target))) {
    return shardFileConflictKey(mutation.filePath);
  }
  // Unknown / non-row, non-metadata targets are treated conservatively as
  // whole-shard so they never silently compose with row edits.
  return shardFileConflictKey(mutation.filePath);
}

/**
 * path-to-atom-map domain adapter (TASK-CID-0094). Targets owner-shard files
 * under `path-to-atom-map-shards/owner-shard-*.json` (NOT the derived projection
 * `path-to-atom-map.json`, NOT `manifest.json`).
 *
 * Conflict-key scheme (LOCKED option A): a mutation addressing a mappings[] row
 * keys on `(path_pattern, atom_id)` so two edits to the same row collide and two
 * edits to different rows merge. Metadata-level mutations widen to the whole
 * shard file. parse/serialize delegate to the generic JSON record adapter.
 */
export const pathToAtomMapAdapter: FileMutationAdapter = {
  id: ATOM_MAP_ADAPTER_ID,

  supports(file: FileDescriptor): boolean {
    const normalized = file.filePath.replace(/\\/g, '/');
    return normalized.includes('/path-to-atom-map-shards/owner-shard-') && normalized.endsWith('.json');
  },

  parse(file: FileDescriptor): ParsedDocument {
    return jsonRecordAdapter.parse(file);
  },

  normalize(request: MutationRequest): NormalizedMutation {
    return {
      requestId: request.requestId,
      actorId: request.actorId,
      filePath: request.filePath,
      op: request.op,
      target: request.target,
      value: request.value
    };
  },

  getConflictKeys(mutation: NormalizedMutation, _parsed: ParsedDocument): readonly ConflictKey[] {
    return [conflictKeyFor(mutation)];
  },

  canMerge(mutations: readonly NormalizedMutation[], _parsed: ParsedDocument): MergeDecision {
    const seen = new Map<string, ConflictKey>();
    const collisions: ConflictKey[] = [];
    for (const mutation of mutations) {
      const key = conflictKeyFor(mutation);
      if (seen.has(key.key)) {
        collisions.push(key);
      } else {
        seen.set(key.key, key);
      }
    }
    if (collisions.length > 0) {
      return {
        schemaId: 'atm.mergeDecision.v1',
        specVersion: '0.1.0',
        migration: brokerAdapterMigration(),
        verdict: 'conflict',
        reason: 'two or more atom-map mutations target the same row identity (path_pattern, atom_id) or the same shard metadata; these edits are not commutative',
        conflictKeys: collisions
      };
    }
    return {
      schemaId: 'atm.mergeDecision.v1',
      specVersion: '0.1.0',
      migration: brokerAdapterMigration(),
      verdict: 'mergeable',
      reason: 'all atom-map mutations target distinct row identities (and no metadata widening collision)',
      conflictKeys: [...seen.values()]
    };
  },

  merge(mutations: readonly NormalizedMutation[], parsed: ParsedDocument): ParsedDocument {
    const decision = pathToAtomMapAdapter.canMerge(mutations, parsed);
    if (decision.verdict === 'conflict') {
      throw new Error(`path-to-atom-map adapter cannot merge conflicting mutations: ${decision.reason}`);
    }
    // Row mutations operate on the mappings[] array keyed by identity; delegate
    // the structural edit to a small mappings-aware applier rather than to the
    // generic JSON-pointer merger (rows are array members, not object members).
    const root = parsed.value as Record<string, unknown>;
    const mappings = Array.isArray(root.mappings) ? [...(root.mappings as Record<string, unknown>[])] : [];
    for (const mutation of mutations) {
      const row = parseRowTarget(mutation.target);
      if (!row) {
        // Metadata-level mutation: set the top-level field directly.
        const field = topLevelTarget(mutation.target);
        (root as Record<string, unknown>)[field] = mutation.value;
        continue;
      }
      const index = mappings.findIndex(
        (entry) => String(entry.path_pattern) === row.pathPattern && String(entry.atom_id) === row.atomId
      );
      if (mutation.op === 'add-if-absent') {
        if (index >= 0) {
          continue;
        }
        mappings.push(mutation.value as Record<string, unknown>);
      } else if (mutation.op === 'replace') {
        if (index < 0) {
          throw new Error(`path-to-atom-map replace requires an existing row: ${row.pathPattern}::${row.atomId}`);
        }
        mappings[index] = mutation.value as Record<string, unknown>;
      } else if (mutation.op === 'upsert') {
        if (index >= 0) {
          mappings[index] = mutation.value as Record<string, unknown>;
        } else {
          mappings.push(mutation.value as Record<string, unknown>);
        }
      } else {
        throw new Error(`path-to-atom-map adapter does not support op '${mutation.op}' (supported: upsert, add-if-absent, replace)`);
      }
    }
    return { filePath: parsed.filePath, value: { ...root, mappings } };
  },

  serialize(parsed: ParsedDocument): string {
    return jsonRecordAdapter.serialize(parsed);
  },

  validate(file: FileDescriptor): ValidationResult {
    const base = jsonRecordAdapter.validate ? jsonRecordAdapter.validate(file) : { ok: true, errors: [] };
    if (!base.ok) {
      return base;
    }
    try {
      const parsed = JSON.parse(file.content) as Record<string, unknown>;
      if (!Array.isArray(parsed.mappings)) {
        return { ok: false, errors: ['owner shard must contain a mappings array'] };
      }
      return { ok: true, errors: [] };
    } catch (error) {
      return { ok: false, errors: [`invalid owner shard JSON: ${error instanceof Error ? error.message : String(error)}`] };
    }
  }
};

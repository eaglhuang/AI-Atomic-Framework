import { brokerAdapterMigration } from '../types.js';
import { jsonRecordAdapter } from './json-record.js';
export const ATOM_MAP_ADAPTER_ID = 'path-to-atom-map';
/**
 * Metadata-level (non-row) fields of a path-to-atom-map owner shard. A mutation
 * touching any of these widens its conflict key to the whole shard file, since
 * editing shard metadata cannot be safely composed with concurrent row edits.
 */
const METADATA_TARGETS = new Set([
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
function parseRowTarget(target) {
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
function topLevelTarget(target) {
    const normalized = target.replace(/^\//, '');
    const slashIndex = normalized.indexOf('/');
    return slashIndex >= 0 ? normalized.slice(0, slashIndex) : normalized;
}
/** Row identity conflict key (LOCKED option A): record:${path_pattern}::${atom_id}. */
function rowConflictKey(pathPattern, atomId) {
    return {
        schemaId: 'atm.conflictKey.v1',
        specVersion: '0.1.0',
        migration: brokerAdapterMigration(),
        scope: 'record',
        key: `record:${pathPattern}::${atomId}`
    };
}
/** Whole-shard conflict key for metadata-level mutations. */
function shardFileConflictKey(shardPath) {
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
function conflictKeyFor(mutation) {
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
export const pathToAtomMapAdapter = {
    id: ATOM_MAP_ADAPTER_ID,
    supports(file) {
        const normalized = file.filePath.replace(/\\/g, '/');
        return normalized.includes('/path-to-atom-map-shards/owner-shard-') && normalized.endsWith('.json');
    },
    parse(file) {
        return jsonRecordAdapter.parse(file);
    },
    normalize(request) {
        return {
            requestId: request.requestId,
            actorId: request.actorId,
            filePath: request.filePath,
            op: request.op,
            target: request.target,
            value: request.value
        };
    },
    getConflictKeys(mutation, _parsed) {
        return [conflictKeyFor(mutation)];
    },
    canMerge(mutations, _parsed) {
        const seen = new Map();
        const collisions = [];
        for (const mutation of mutations) {
            const key = conflictKeyFor(mutation);
            if (seen.has(key.key)) {
                collisions.push(key);
            }
            else {
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
    merge(mutations, parsed) {
        const decision = pathToAtomMapAdapter.canMerge(mutations, parsed);
        if (decision.verdict === 'conflict') {
            throw new Error(`path-to-atom-map adapter cannot merge conflicting mutations: ${decision.reason}`);
        }
        // Row mutations operate on the mappings[] array keyed by identity; delegate
        // the structural edit to a small mappings-aware applier rather than to the
        // generic JSON-pointer merger (rows are array members, not object members).
        const root = parsed.value;
        const mappings = Array.isArray(root.mappings) ? [...root.mappings] : [];
        for (const mutation of mutations) {
            const row = parseRowTarget(mutation.target);
            if (!row) {
                // Metadata-level mutation: set the top-level field directly.
                const field = topLevelTarget(mutation.target);
                root[field] = mutation.value;
                continue;
            }
            const index = mappings.findIndex((entry) => String(entry.path_pattern) === row.pathPattern && String(entry.atom_id) === row.atomId);
            if (mutation.op === 'add-if-absent') {
                if (index >= 0) {
                    continue;
                }
                mappings.push(mutation.value);
            }
            else if (mutation.op === 'replace') {
                if (index < 0) {
                    throw new Error(`path-to-atom-map replace requires an existing row: ${row.pathPattern}::${row.atomId}`);
                }
                mappings[index] = mutation.value;
            }
            else if (mutation.op === 'upsert') {
                if (index >= 0) {
                    mappings[index] = mutation.value;
                }
                else {
                    mappings.push(mutation.value);
                }
            }
            else {
                throw new Error(`path-to-atom-map adapter does not support op '${mutation.op}' (supported: upsert, add-if-absent, replace)`);
            }
        }
        return { filePath: parsed.filePath, value: { ...root, mappings } };
    },
    serialize(parsed) {
        return jsonRecordAdapter.serialize(parsed);
    },
    validate(file) {
        const base = jsonRecordAdapter.validate ? jsonRecordAdapter.validate(file) : { ok: true, errors: [] };
        if (!base.ok) {
            return base;
        }
        try {
            const parsed = JSON.parse(file.content);
            if (!Array.isArray(parsed.mappings)) {
                return { ok: false, errors: ['owner shard must contain a mappings array'] };
            }
            return { ok: true, errors: [] };
        }
        catch (error) {
            return { ok: false, errors: [`invalid owner shard JSON: ${error instanceof Error ? error.message : String(error)}`] };
        }
    }
};

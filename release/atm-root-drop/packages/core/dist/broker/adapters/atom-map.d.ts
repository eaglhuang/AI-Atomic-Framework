import { type FileMutationAdapter } from '../types.ts';
export declare const ATOM_MAP_ADAPTER_ID = "path-to-atom-map";
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
export declare const pathToAtomMapAdapter: FileMutationAdapter;

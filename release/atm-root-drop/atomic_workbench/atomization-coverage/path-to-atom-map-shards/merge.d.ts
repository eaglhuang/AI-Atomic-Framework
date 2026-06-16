export const SHARDS_MANIFEST_REL: string;
export const PROJECTION_REL: string;

export interface PathMapping {
  path_pattern: string;
  atom_id: string;
  capability: string;
  coverage_status: string;
  source_task?: string;
}

export interface PathToAtomMapDocument {
  schemaId?: string;
  mappings: PathMapping[];
  summary?: Record<string, unknown>;
  sharding?: Record<string, unknown>;
}

export interface ShardManifest {
  schemaId: string;
  mergeStrategy: string;
  projectionPath: string;
  shardPaths: string[];
}

export interface ProjectionEquivalenceResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  detail?: string;
  mappingCount?: number;
}

export function resolveRepoPath(repoRoot: string, relativePath: string): string;
export function loadManifest(repoRoot: string): ShardManifest | null;
export function mergeOwnerShards(repoRoot: string, manifest?: ShardManifest): PathToAtomMapDocument;
export function loadPathToAtomMap(repoRoot: string): PathToAtomMapDocument;
export function validateProjectionMatchesShards(repoRoot: string): ProjectionEquivalenceResult;
export function writeProjectionFromShards(
  repoRoot: string,
  manifest?: ShardManifest
): { projectionPath: string; mappingCount: number };

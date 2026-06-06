import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface MapBundleMember {
  atomCid: string;
  role: string;
}

export interface MapBundleEdge {
  from: string;  // atomCid
  to: string;    // atomCid
  binding: string;
  edgeKind?: string;
}

export interface MapBundle {
  specVersion: string;
  members: MapBundleMember[];
  edges: MapBundleEdge[];
  entrypoints: string[]; // atomCids
  qualityTargets?: Record<string, string | number | boolean>;
}

export interface MapCapsule {
  mapCid: string;
  bundle: MapBundle;
  compressedPayload: string;
}

export interface MapCapsuleExportResult {
  mapCid: string;
  compressedPayload: string;
  memberAtomCids: string[];
  memberCapsules: Array<{ atomCid: string; compressedPayload: string }>;
}

export class MapCapsuleError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'MapCapsuleError';
    this.code = code;
    this.details = details;
  }
}

const MAP_CID_PREFIX = 'map:cid:';
const MAP_CACHE_DIR = path.join(os.homedir(), '.atm', 'map-cache');

export function computeMapCid(bundle: MapBundle): string {
  // Merkle tree: bundle uses atomCids which already encode atom content
  const canonical = JSON.stringify({
    specVersion: bundle.specVersion,
    members: [...bundle.members].sort((a, b) => a.atomCid.localeCompare(b.atomCid)),
    edges: [...bundle.edges].sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`)),
    entrypoints: [...bundle.entrypoints].sort(),
    qualityTargets: bundle.qualityTargets ?? {}
  });

  const compressed = brotliCompressSync(Buffer.from(canonical, 'utf-8'));
  const hash = createHash('sha256').update(compressed).digest('base64url');
  return `${MAP_CID_PREFIX}${hash}`;
}

export function exportMapCapsule(bundle: MapBundle): MapCapsule {
  const mapCid = computeMapCid(bundle);
  const canonical = JSON.stringify({
    specVersion: bundle.specVersion,
    members: [...bundle.members].sort((a, b) => a.atomCid.localeCompare(b.atomCid)),
    edges: [...bundle.edges].sort((a, b) => `${a.from}->${a.to}`.localeCompare(`${b.from}->${b.to}`)),
    entrypoints: [...bundle.entrypoints].sort(),
    qualityTargets: bundle.qualityTargets ?? {}
  });
  const compressed = brotliCompressSync(Buffer.from(canonical, 'utf-8'));
  return {
    mapCid,
    bundle,
    compressedPayload: compressed.toString('base64')
  };
}

export function importMapCapsule(
  mapCid: string,
  compressedPayload: string,
  options: { vendorDir?: string; repositoryRoot?: string } = {}
): { mapCid: string; bundle: MapBundle; bundlePath: string; verified: boolean } {
  validateMapCidFormat(mapCid);

  // L1: Hash verify
  if (!verifyMapPayloadHash(mapCid, compressedPayload)) {
    throw new MapCapsuleError(
      'ATM_MAP_CAPSULE_HASH_MISMATCH',
      `map:cid hash verification failed for ${mapCid}. The payload may be corrupted.`,
      { mapCid }
    );
  }

  // L2: Decompress
  let bundle: MapBundle;
  try {
    const compressed = Buffer.from(compressedPayload, 'base64');
    const decompressed = brotliDecompressSync(compressed).toString('utf-8');
    bundle = JSON.parse(decompressed);
  } catch (err) {
    throw new MapCapsuleError(
      'ATM_MAP_CAPSULE_DECOMPRESS_FAILED',
      `Failed to decompress map capsule for ${mapCid}.`,
      { mapCid, cause: String(err) }
    );
  }

  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const vendorDir = options.vendorDir ?? path.join(repositoryRoot, 'vendor', 'maps');
  mkdirSync(vendorDir, { recursive: true });

  const shortId = mapCidToShortId(mapCid);
  const bundlePath = path.join(vendorDir, `${shortId}.json`);
  writeFileSync(bundlePath, JSON.stringify({ mapCid, bundle, importedAt: new Date().toISOString() }, null, 2) + '\n');

  return { mapCid, bundle, bundlePath, verified: true };
}

export function convertSpecToMapBundle(
  mapSpec: {
    specVersion?: string;
    members: Array<{ atomId: string; version?: string }>;
    edges: Array<{ from: string; to: string; binding: string; edgeKind?: string }>;
    entrypoints: string[];
    qualityTargets?: Record<string, string | number | boolean>;
  },
  atomCidMap: Record<string, string>  // atomId -> atomCid
): MapBundle {
  const members: MapBundleMember[] = mapSpec.members.map((m) => {
    const atomCid = atomCidMap[m.atomId];
    if (!atomCid) {
      throw new MapCapsuleError(
        'ATM_MAP_CAPSULE_MISSING_ATOM_CID',
        `No CID found for atom ${m.atomId}. Export or import the atom capsule first.`,
        { atomId: m.atomId }
      );
    }
    return { atomCid, role: m.atomId };
  });

  const edges: MapBundleEdge[] = mapSpec.edges.map((e) => ({
    from: atomCidMap[e.from] ?? e.from,
    to: atomCidMap[e.to] ?? e.to,
    binding: e.binding,
    edgeKind: e.edgeKind
  }));

  const entrypoints = mapSpec.entrypoints.map((id) => atomCidMap[id] ?? id);

  return {
    specVersion: mapSpec.specVersion ?? '0.2.0',
    members,
    edges,
    entrypoints,
    qualityTargets: mapSpec.qualityTargets
  };
}

export function verifyMapPayloadHash(mapCid: string, compressedPayload: string): boolean {
  try {
    const compressed = Buffer.from(compressedPayload, 'base64');
    const hash = createHash('sha256').update(compressed).digest('base64url');
    return hash === mapCid.slice(MAP_CID_PREFIX.length);
  } catch {
    return false;
  }
}

export function validateMapCidFormat(mapCid: string): void {
  if (!mapCid.startsWith(MAP_CID_PREFIX)) {
    throw new MapCapsuleError(
      'ATM_MAP_CAPSULE_INVALID_CID',
      `Invalid map:cid format. Must start with "${MAP_CID_PREFIX}". Got: ${mapCid}`,
      { mapCid }
    );
  }
  const hash = mapCid.slice(MAP_CID_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{43,}$/.test(hash)) {
    throw new MapCapsuleError('ATM_MAP_CAPSULE_INVALID_CID', `Invalid map:cid hash segment.`, { mapCid });
  }
}

export function mapCidToShortId(mapCid: string): string {
  return mapCid.slice(MAP_CID_PREFIX.length, MAP_CID_PREFIX.length + 16);
}

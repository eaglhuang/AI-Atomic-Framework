import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync } from 'node:zlib';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface AtomBundle {
  canonicalSourceCode: string;
  inputSchema: unknown;
  outputSchema: unknown;
  policeConfig: unknown;
}

export interface AtomCapsule {
  cid: string;
  bundle: AtomBundle;
  compressedPayload: string; // Base64-encoded brotli-compressed bundle
}

export interface CapsuleImportResult {
  cid: string;
  bundlePath: string;
  verified: boolean;
  fromCache: boolean;
  warnings: string[];
}

export class AtomCapsuleError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    message: string,
    details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'AtomCapsuleError';
    this.code = code;
    this.details = details;
  }
}

const CID_PREFIX = 'atom:cid:';
const CACHE_DIR = path.join(os.homedir(), '.atm', 'capsule-cache');

export function computeAtomCid(bundle: AtomBundle): string {
  // Only bundle content enters the hash (not provenance)
  const canonical = JSON.stringify({
    canonicalSourceCode: bundle.canonicalSourceCode,
    inputSchema: bundle.inputSchema,
    outputSchema: bundle.outputSchema,
    policeConfig: bundle.policeConfig
  });

  const compressed = brotliCompressSync(Buffer.from(canonical, 'utf-8'));
  const hash = createHash('sha256').update(compressed).digest('base64url');
  return `${CID_PREFIX}${hash}`;
}

export function exportAtomCapsule(bundle: AtomBundle): AtomCapsule {
  const cid = computeAtomCid(bundle);
  const canonical = JSON.stringify({
    canonicalSourceCode: bundle.canonicalSourceCode,
    inputSchema: bundle.inputSchema,
    outputSchema: bundle.outputSchema,
    policeConfig: bundle.policeConfig
  });
  const compressed = brotliCompressSync(Buffer.from(canonical, 'utf-8'));
  return {
    cid,
    bundle,
    compressedPayload: compressed.toString('base64')
  };
}

export function importAtomCapsule(
  cid: string,
  compressedPayload: string,
  options: { vendorDir?: string; repositoryRoot?: string } = {}
): CapsuleImportResult {
  validateCidFormat(cid);

  const warnings: string[] = [];
  let fromCache = false;
  const cacheDir = CACHE_DIR;
  const cidShort = cidToShortId(cid);
  const cachePath = path.join(cacheDir, `${cidShort}.bin`);

  // Check local cache first
  if (existsSync(cachePath)) {
    fromCache = true;
    const cachedPayload = readFileSync(cachePath).toString('base64');
    if (verifyPayloadHash(cid, cachedPayload)) {
      compressedPayload = cachedPayload;
    } else {
      warnings.push(`Cache hit for ${cidShort} but hash verification failed; re-importing from provided payload`);
      fromCache = false;
    }
  }

  // Verify hash integrity (L1 check)
  if (!verifyPayloadHash(cid, compressedPayload)) {
    throw new AtomCapsuleError(
      'ATM_CAPSULE_HASH_MISMATCH',
      `CID hash verification failed for ${cid}. The payload may be corrupted.`,
      { cid, cidShort }
    );
  }

  // Decompress (L2 check)
  let bundle: AtomBundle;
  try {
    const compressed = Buffer.from(compressedPayload, 'base64');
    const decompressed = brotliDecompressSync(compressed).toString('utf-8');
    bundle = JSON.parse(decompressed);
  } catch (err) {
    throw new AtomCapsuleError(
      'ATM_CAPSULE_DECOMPRESS_FAILED',
      `Failed to decompress capsule payload for ${cid}. The payload may be truncated or malformed.`,
      { cid, cidShort, cause: String(err) }
    );
  }

  // Validate bundle structure (L3 check)
  validateBundleStructure(bundle, cid);

  // Write to cache
  if (!fromCache) {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cachePath, Buffer.from(compressedPayload, 'base64'));
  }

  // Vendor into repo
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const vendorDir = options.vendorDir ?? path.join(repositoryRoot, 'vendor', 'atoms');
  mkdirSync(vendorDir, { recursive: true });
  const vendorPath = path.join(vendorDir, `${cidShort}.json`);
  const vendorEntry = { cid, bundle, importedAt: new Date().toISOString() };
  writeFileSync(vendorPath, JSON.stringify(vendorEntry, null, 2) + '\n');

  return {
    cid,
    bundlePath: vendorPath,
    verified: true,
    fromCache,
    warnings
  };
}

export function verifyPayloadHash(cid: string, compressedPayload: string): boolean {
  try {
    const compressed = Buffer.from(compressedPayload, 'base64');
    const hash = createHash('sha256').update(compressed).digest('base64url');
    const expectedHash = cid.slice(CID_PREFIX.length);
    return hash === expectedHash;
  } catch {
    return false;
  }
}

export function parseCid(cid: string): { prefix: string; hash: string } {
  validateCidFormat(cid);
  return {
    prefix: CID_PREFIX,
    hash: cid.slice(CID_PREFIX.length)
  };
}

export function cidToShortId(cid: string): string {
  return cid.slice(CID_PREFIX.length, CID_PREFIX.length + 16);
}

export function validateCidFormat(cid: string): void {
  if (!cid.startsWith(CID_PREFIX)) {
    throw new AtomCapsuleError(
      'ATM_CAPSULE_INVALID_CID',
      `Invalid CID format: must start with "${CID_PREFIX}". Got: ${cid}`,
      { cid }
    );
  }
  const hash = cid.slice(CID_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{43,}$/.test(hash)) {
    throw new AtomCapsuleError(
      'ATM_CAPSULE_INVALID_CID',
      `Invalid CID hash segment. Expected base64url-encoded SHA256.`,
      { cid, hash }
    );
  }
}

function validateBundleStructure(bundle: unknown, cid: string): asserts bundle is AtomBundle {
  if (!bundle || typeof bundle !== 'object') {
    throw new AtomCapsuleError(
      'ATM_CAPSULE_SCHEMA_INVALID',
      `Capsule bundle for ${cid} is not a valid object.`,
      { cid }
    );
  }
  const b = bundle as Record<string, unknown>;
  if (typeof b.canonicalSourceCode !== 'string') {
    throw new AtomCapsuleError(
      'ATM_CAPSULE_SCHEMA_INVALID',
      `Capsule bundle for ${cid} is missing or invalid canonicalSourceCode field.`,
      { cid }
    );
  }
}

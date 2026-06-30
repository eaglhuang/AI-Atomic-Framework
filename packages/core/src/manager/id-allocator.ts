import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const atomIdPattern = /^ATM-([A-Z][A-Z0-9]*)-(\d{4})$/;
const bucketPattern = /^[A-Z][A-Z0-9]*$/;

export class AtomIdAllocationError extends Error {
  declare code: string;
  declare details: Record<string, unknown>;

  constructor(code: string, text: string, details: Record<string, unknown> = {}) {
    super(text);
    this.name = 'AtomIdAllocationError';
    this.code = code;
    this.details = details;
  }
}

interface AtomRegistryEntryLike {
  atomId?: string;
  id?: string;
}

interface AtomRegistryDocumentLike {
  entries?: unknown[];
}

interface AllocateAtomIdOptions {
  repositoryRoot?: string;
  registryPath?: string;
  registryDocument?: AtomRegistryDocumentLike | null;
}

export function normalizeAtomBucket(bucket: unknown) {
  if (typeof bucket !== 'string') {
    throw new AtomIdAllocationError('ATM_BUCKET_REQUIRED', 'Atom ID bucket must be a string.', { bucket });
  }

  const normalizedBucket = bucket.trim().toUpperCase();
  if (!bucketPattern.test(normalizedBucket)) {
    throw new AtomIdAllocationError('ATM_BUCKET_INVALID', 'Atom ID bucket must match /^[A-Z][A-Z0-9]*$/.', { bucket });
  }

  return normalizedBucket;
}

export function parseAtomId(atomId: unknown) {
  const match = String(atomId || '').trim().match(atomIdPattern);
  if (!match) {
    return null;
  }
  return {
    atomId: match[0],
    bucket: match[1],
    sequence: Number.parseInt(match[2], 10)
  };
}

export function allocateAtomId(bucket: unknown, options: AllocateAtomIdOptions = {}) {
  const normalizedBucket = normalizeAtomBucket(bucket);
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const registryPath = path.resolve(repositoryRoot, options.registryPath ?? 'atomic-registry.json');
  const registryDocument = options.registryDocument ?? readRegistryDocument(registryPath);
  const entries = Array.isArray(registryDocument?.entries) ? registryDocument.entries : [];
  const maxSequence = entries.reduce((currentMax: number, entry: unknown) => {
    const registryEntry = entry as AtomRegistryEntryLike;
    const parsed = parseAtomId(registryEntry?.atomId ?? registryEntry?.id);
    if (!parsed || parsed.bucket !== normalizedBucket) {
      return currentMax;
    }
    return Math.max(currentMax, parsed.sequence);
  }, 0);
  const sequence = maxSequence + 1;

  return {
    atomId: `ATM-${normalizedBucket}-${String(sequence).padStart(4, '0')}`,
    bucket: normalizedBucket,
    sequence,
    source: toProjectPath(repositoryRoot, registryPath),
    reservation: null
  };
}

function readRegistryDocument(registryPath: string): AtomRegistryDocumentLike {
  if (!existsSync(registryPath)) {
    return { entries: [] };
  }

  try {
    return JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch (error) {
    throw new AtomIdAllocationError('ATM_REGISTRY_INVALID', 'Atomic registry JSON is invalid.', {
      registryPath: toPortablePath(registryPath),
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function toProjectPath(repositoryRoot: string, filePath: string) {
  const relativePath = path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('..')) {
    return toPortablePath(filePath);
  }
  return relativePath;
}

function toPortablePath(value: string) {
  return String(value).replace(/\\/g, '/');
}

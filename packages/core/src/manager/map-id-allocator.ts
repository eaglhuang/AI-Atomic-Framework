import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const mapIdPattern = /^ATM-MAP-(\d{4})$/;

export class MapIdAllocationError extends Error {
  declare code: string;
  declare details: Record<string, unknown>;

  constructor(code: string, text: string, details: Record<string, unknown> = {}) {
    super(text);
    this.name = 'MapIdAllocationError';
    this.code = code;
    this.details = details;
  }
}

interface MapRegistryEntryLike {
  mapId?: string;
}

interface MapRegistryDocumentLike {
  entries?: unknown[];
}

interface AllocateMapIdOptions {
  repositoryRoot?: string;
  registryPath?: string;
  registryDocument?: MapRegistryDocumentLike | null;
}

export function parseMapId(mapId: unknown) {
  const match = String(mapId || '').trim().match(mapIdPattern);
  if (!match) {
    return null;
  }

  return {
    mapId: match[0],
    bucket: 'MAP',
    sequence: Number.parseInt(match[1], 10)
  };
}

export function allocateMapId(options: AllocateMapIdOptions = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const registryPath = path.resolve(repositoryRoot, options.registryPath ?? 'atomic-registry.json');
  const registryDocument = options.registryDocument ?? readRegistryDocument(registryPath);
  const entries = Array.isArray(registryDocument?.entries) ? registryDocument.entries : [];
  const maxSequence = entries.reduce((currentMax: number, entry: unknown) => {
    const registryEntry = entry as MapRegistryEntryLike;
    const parsed = parseMapId(registryEntry?.mapId);
    if (!parsed) {
      return currentMax;
    }
    return Math.max(currentMax, parsed.sequence);
  }, 0);
  const sequence = maxSequence + 1;

  return {
    mapId: `ATM-MAP-${String(sequence).padStart(4, '0')}`,
    bucket: 'MAP',
    sequence,
    source: toProjectPath(repositoryRoot, registryPath),
    reservation: null
  };
}

function readRegistryDocument(registryPath: string): MapRegistryDocumentLike {
  if (!existsSync(registryPath)) {
    return { entries: [] };
  }

  try {
    return JSON.parse(readFileSync(registryPath, 'utf8'));
  } catch (error) {
    throw new MapIdAllocationError('ATM_REGISTRY_INVALID', 'Atomic registry JSON is invalid.', {
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

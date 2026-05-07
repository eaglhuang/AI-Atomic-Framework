import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const mapIdPattern = /^ATM-MAP-(\d{4})$/;

export class MapIdAllocationError extends Error {
  constructor(code, text, details = {}) {
    super(text);
    this.name = 'MapIdAllocationError';
    this.code = code;
    this.details = details;
  }
}

export function parseMapId(mapId) {
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

export function allocateMapId(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? process.cwd());
  const registryPath = path.resolve(repositoryRoot, options.registryPath ?? 'atomic-registry.json');
  const registryDocument = options.registryDocument ?? readRegistryDocument(registryPath);
  const entries = Array.isArray(registryDocument?.entries) ? registryDocument.entries : [];
  const maxSequence = entries.reduce((currentMax, entry) => {
    const parsed = parseMapId(entry?.mapId);
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

function readRegistryDocument(registryPath) {
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

function toProjectPath(repositoryRoot, filePath) {
  const relativePath = path.relative(repositoryRoot, filePath).replace(/\\/g, '/');
  if (!relativePath || relativePath.startsWith('..')) {
    return toPortablePath(filePath);
  }
  return relativePath;
}

function toPortablePath(value) {
  return String(value).replace(/\\/g, '/');
}
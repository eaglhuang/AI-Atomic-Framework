import { formatAtmUrn, normalizeAtmNodeRef } from './urn.mjs';

export class RegistryIndexError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'RegistryIndexError';
    this.code = code;
    this.details = details;
  }
}

export function createRegistryIndex(registryDocument, options = {}) {
  const entries = Array.isArray(registryDocument?.entries) ? registryDocument.entries : [];
  const atomIdIndex = new Map();
  const mapIdIndex = new Map();
  const logicalNameIndex = new Map();
  const fingerprintIndex = new Map();
  const versionIndex = new Map();
  const nodeRefs = [];
  const diagnostics = [];

  for (const entry of entries) {
    const nodeRef = createNodeRef(entry);
    if (!nodeRef) {
      diagnostics.push({ code: 'ATM_REGISTRY_INDEX_ENTRY_SKIPPED', severity: 'warning', entry });
      continue;
    }

    const targetIndex = nodeRef.nodeKind === 'map' ? mapIdIndex : atomIdIndex;
    addUnique(targetIndex, nodeRef.canonicalId, nodeRef, options);
    nodeRefs.push(nodeRef);

    if (entry.logicalName) {
      addToMultiMap(logicalNameIndex, entry.logicalName, nodeRef);
    }

    const fingerprint = normalizeSemanticFingerprint(entry.semanticFingerprint ?? entry.mapSemanticFingerprint ?? null);
    if (fingerprint) {
      addToMultiMap(fingerprintIndex, semanticFingerprintPrefix(fingerprint), nodeRef);
      addToMultiMap(fingerprintIndex, fingerprint, nodeRef);
    }

    addVersions(versionIndex, nodeRef, entry);
  }

  return Object.freeze({
    registryId: registryDocument?.registryId ?? null,
    size: nodeRefs.length,
    diagnostics,
    atomIdIndex,
    mapIdIndex,
    logicalNameIndex,
    fingerprintIndex,
    versionIndex,
    nodeRefs,
    getByCanonicalId(canonicalId) {
      const normalized = normalizeAtmNodeRef(canonicalId);
      return normalized.nodeKind === 'map'
        ? mapIdIndex.get(normalized.canonicalId) ?? null
        : atomIdIndex.get(normalized.canonicalId) ?? null;
    },
    getByUrn(urn) {
      const normalized = normalizeAtmNodeRef(urn);
      return normalized.nodeKind === 'map'
        ? mapIdIndex.get(normalized.canonicalId) ?? null
        : atomIdIndex.get(normalized.canonicalId) ?? null;
    },
    findByLogicalName(logicalName) {
      return logicalNameIndex.get(String(logicalName || '').trim()) ?? [];
    },
    findBySemanticFingerprint(fingerprint) {
      const normalized = normalizeSemanticFingerprint(fingerprint);
      return normalized ? fingerprintIndex.get(normalized) ?? [] : [];
    },
    findByFingerprintPrefix(prefix) {
      return fingerprintIndex.get(String(prefix || '').trim().toLowerCase()) ?? [];
    },
    getVersions(canonicalId) {
      const normalized = normalizeAtmNodeRef(canonicalId);
      const record = versionIndex.get(normalized.canonicalId);
      if (!record) {
        return { current: null, versions: [] };
      }
      return {
        current: record.current,
        versions: [...record.versions]
      };
    },
    toJSON() {
      return {
        registryId: registryDocument?.registryId ?? null,
        size: nodeRefs.length,
        atomIds: [...atomIdIndex.keys()],
        mapIds: [...mapIdIndex.keys()],
        logicalNames: [...logicalNameIndex.keys()],
        fingerprintKeys: [...fingerprintIndex.keys()],
        versionKeys: [...versionIndex.keys()],
        diagnostics
      };
    }
  });
}

export function createNodeRef(entry) {
  if (entry?.mapId) {
    return buildNodeRef('map', entry.mapId, entry.mapVersion ?? entry.currentVersion ?? null, entry);
  }
  const atomId = entry?.atomId ?? entry?.id;
  if (atomId) {
    return buildNodeRef('atom', atomId, entry.atomVersion ?? entry.currentVersion ?? null, entry);
  }
  return null;
}

export function normalizeSemanticFingerprint(value) {
  if (!value) {
    return null;
  }
  const text = String(value).trim().toLowerCase();
  if (/^sf:sha256:[a-f0-9]{64}$/.test(text) || /^sha256:[a-f0-9]{64}$/.test(text) || /^[a-f0-9]{64}$/.test(text)) {
    return text;
  }
  throw new RegistryIndexError('ATM_SEMANTIC_FINGERPRINT_INVALID', 'Semantic fingerprint must be sha256-like text.', { value });
}

export function semanticFingerprintPrefix(fingerprint, length = 16) {
  const normalized = normalizeSemanticFingerprint(fingerprint);
  const hex = normalized.replace(/^sf:sha256:/, '').replace(/^sha256:/, '');
  return hex.slice(0, length);
}

function buildNodeRef(nodeKind, canonicalId, version, entry) {
  const urn = formatAtmUrn({ nodeKind, canonicalId, version });
  const normalized = normalizeAtmNodeRef(urn);
  return Object.freeze({
    nodeKind: normalized.nodeKind,
    canonicalId: normalized.canonicalId,
    version: normalized.version,
    urn: normalized.urn,
    entry
  });
}

function addUnique(index, key, value, options) {
  if (index.has(key)) {
    const message = `Duplicate registry canonical ID: ${key}`;
    if (options.allowDuplicates) {
      return;
    }
    throw new RegistryIndexError('ATM_REGISTRY_INDEX_DUPLICATE_KEY', message, { key });
  }
  index.set(key, value);
}

function addToMultiMap(index, key, value) {
  if (!key) {
    return;
  }
  const normalizedKey = String(key).trim().toLowerCase();
  const current = index.get(normalizedKey) ?? [];
  current.push(value);
  index.set(normalizedKey, current);
}

function addVersions(index, nodeRef, entry) {
  const record = index.get(nodeRef.canonicalId) ?? { current: null, versions: new Set() };
  if (nodeRef.version) {
    record.current = nodeRef.version;
    record.versions.add(nodeRef.version);
  }
  if (Array.isArray(entry.versions)) {
    for (const versionRecord of entry.versions) {
      if (versionRecord?.version) {
        record.versions.add(versionRecord.version);
      }
    }
  }
  index.set(nodeRef.canonicalId, record);
}
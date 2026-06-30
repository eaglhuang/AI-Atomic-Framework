import { normalizeSemanticFingerprint, semanticFingerprintPrefix } from './semantic-fingerprint.ts';
import { formatAtmUrn, normalizeAtmNodeRef } from './urn.ts';

export class RegistryIndexError extends Error {
  declare code: string;
  declare details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'RegistryIndexError';
    this.code = code;
    this.details = details;
  }
}

// ─── Domain types ──────────────────────────────────────────────────────────

interface RegistryEntry {
  atomId?: string;
  id?: string;
  mapId?: string;
  mapVersion?: string;
  atomVersion?: string;
  currentVersion?: string;
  logicalName?: string;
  semanticFingerprint?: string | null;
  mapSemanticFingerprint?: string | null;
  versions?: Array<{ version?: string }>;
  members?: RegistryMember[];
  schemaId?: string;
}

interface RegistryMember {
  atomId?: string;
  version?: string;
  versionLineage?: {
    currentVersion?: string;
    versions?: Array<{ version?: string }>;
  };
}

interface NodeRef {
  nodeKind: 'atom' | 'map';
  canonicalId: string;
  version: string | null;
  urn: string;
  entry: RegistryEntry;
}

interface DiagnosticRecord {
  code: string;
  severity: string;
  entry: RegistryEntry;
}

interface VersionRecord {
  current: string | null;
  versions: Set<string>;
}

interface CreateRegistryIndexOptions {
  allowDuplicates?: boolean;
  repositoryRoot?: string;
}

interface RegistryDocument {
  entries?: RegistryEntry[];
  registryId?: string;
}

export function createRegistryIndex(registryDocument: RegistryDocument | null | undefined, options: CreateRegistryIndexOptions = {}) {
  const entries = Array.isArray(registryDocument?.entries) ? registryDocument!.entries! : [];
  const atomIdIndex = new Map<string, NodeRef>();
  const mapIdIndex = new Map<string, NodeRef>();
  const logicalNameIndex = new Map<string, NodeRef[]>();
  const fingerprintIndex = new Map<string, NodeRef[]>();
  const versionIndex = new Map<string, VersionRecord>();
  const nodeRefs: NodeRef[] = [];
  const diagnostics: DiagnosticRecord[] = [];

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
    if (nodeRef.nodeKind === 'map' && Array.isArray(entry.members)) {
      addMemberVersions(versionIndex, atomIdIndex, entry.members);
    }
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
    getByCanonicalId(canonicalId: string) {
      const normalized = normalizeAtmNodeRef(canonicalId);
      return normalized.nodeKind === 'map'
        ? mapIdIndex.get(normalized.canonicalId) ?? null
        : atomIdIndex.get(normalized.canonicalId) ?? null;
    },
    getByUrn(urn: string) {
      const normalized = normalizeAtmNodeRef(urn);
      return normalized.nodeKind === 'map'
        ? mapIdIndex.get(normalized.canonicalId) ?? null
        : atomIdIndex.get(normalized.canonicalId) ?? null;
    },
    findByLogicalName(logicalName: string) {
      return logicalNameIndex.get(String(logicalName || '').trim()) ?? [];
    },
    findBySemanticFingerprint(fingerprint: string) {
      const normalized = normalizeSemanticFingerprint(fingerprint);
      return normalized ? fingerprintIndex.get(normalized) ?? [] : [];
    },
    findByFingerprintPrefix(prefix: string) {
      return fingerprintIndex.get(String(prefix || '').trim().toLowerCase()) ?? [];
    },
    getVersions(canonicalId: string) {
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

export function createNodeRef(entry: RegistryEntry | null | undefined): NodeRef | null {
  if (entry?.mapId) {
    return buildNodeRef('map', entry.mapId, entry.mapVersion ?? entry.currentVersion ?? null, entry);
  }
  const atomId = entry?.atomId ?? entry?.id;
  if (atomId) {
    return buildNodeRef('atom', atomId, entry!.atomVersion ?? entry!.currentVersion ?? null, entry!);
  }
  return null;
}

export { normalizeSemanticFingerprint, semanticFingerprintPrefix };

function buildNodeRef(nodeKind: 'atom' | 'map', canonicalId: string, version: string | null | undefined, entry: RegistryEntry): NodeRef {
  const urn = formatAtmUrn({ nodeKind, canonicalId, version });
  const normalized = normalizeAtmNodeRef(urn);
  return Object.freeze({
    nodeKind: normalized.nodeKind as 'atom' | 'map',
    canonicalId: normalized.canonicalId,
    version: normalized.version,
    urn: normalized.urn,
    entry
  });
}

function addUnique(index: Map<string, NodeRef>, key: string, value: NodeRef, options: CreateRegistryIndexOptions): void {
  if (index.has(key)) {
    const message = `Duplicate registry canonical ID: ${key}`;
    if (options.allowDuplicates) {
      return;
    }
    throw new RegistryIndexError('ATM_REGISTRY_INDEX_DUPLICATE_KEY', message, { key });
  }
  index.set(key, value);
}

function addToMultiMap(index: Map<string, NodeRef[]>, key: string, value: NodeRef): void {
  if (!key) {
    return;
  }
  const normalizedKey = String(key).trim().toLowerCase();
  const current = index.get(normalizedKey) ?? [];
  current.push(value);
  index.set(normalizedKey, current);
}

function addVersions(index: Map<string, VersionRecord>, nodeRef: NodeRef, entry: RegistryEntry): void {
  const record = index.get(nodeRef.canonicalId) ?? { current: null, versions: new Set<string>() };
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

function addMemberVersions(index: Map<string, VersionRecord>, atomIdIndex: Map<string, NodeRef>, members: RegistryMember[]): void {
  for (const member of members) {
    const atomId = String(member?.atomId ?? '').trim();
    if (!atomId || atomIdIndex.has(atomId)) {
      continue;
    }

    const lineage = member?.versionLineage;
    const versions = Array.isArray(lineage?.versions) && lineage!.versions!.length > 0
      ? lineage!.versions!
      : member?.version
        ? [{ version: String(member.version).trim() }]
        : [];
    if (versions.length === 0) {
      continue;
    }

    const lastVersion = versions[versions.length - 1]?.version ?? '';
    const currentVersion = String(lineage?.currentVersion ?? member?.version ?? lastVersion).trim();
    const record = index.get(atomId) ?? { current: null, versions: new Set<string>() };
    if (currentVersion) {
      record.current = currentVersion;
    }
    for (const versionRecord of versions) {
      if (versionRecord?.version) {
        record.versions.add(String(versionRecord.version).trim());
      }
    }
    index.set(atomId, record);
  }
}

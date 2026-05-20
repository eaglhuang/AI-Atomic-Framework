import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');

export interface RegistryDiffResolvedEntry {
  readonly atomId: string;
  readonly versions: readonly any[];
  readonly sourceKind: 'atom-entry' | 'member-version-lineage';
  readonly sourceRef?: string;
  readonly registryEntry?: any;
  readonly memberIndex?: number;
  readonly mapId?: string;
}

export interface RegistryDiffResolutionSuccess {
  readonly ok: true;
  readonly entry: RegistryDiffResolvedEntry;
}

export interface RegistryDiffResolutionFailure {
  readonly ok: false;
  readonly code: 'ATM_DIFF_ATOM_NOT_FOUND' | 'ATM_DIFF_LINEAGE_MISSING';
  readonly summary: string;
  readonly advisory: string;
  readonly details: {
    readonly atomId: string;
    readonly candidateMapIds: readonly string[];
    readonly candidateMemberPaths: readonly string[];
    readonly requiredContract: {
      readonly field: string;
      readonly requiredProperties: readonly string[];
      readonly note: string;
    };
  };
}

export type RegistryDiffResolution = RegistryDiffResolutionSuccess | RegistryDiffResolutionFailure;

export function findRegistryEntry(registryDoc: any, atomId: any) {
  if (!registryDoc?.entries || !Array.isArray(registryDoc.entries)) {
    return null;
  }
  return registryDoc.entries.find(
    (entry: any) => entry.atomId === atomId || entry.id === atomId
  ) ?? null;
}

export function findVersionRecord(entry: any, version: any) {
  if (!entry?.versions || !Array.isArray(entry.versions)) {
    return null;
  }
  return entry.versions.find((v: any) => v.version === version) ?? null;
}

export function resolveRegistryDiffTarget(registryDoc: any, atomId: any): RegistryDiffResolution {
  const normalizedAtomId = String(atomId ?? '').trim();
  const candidateMemberPaths: string[] = [];
  const candidateMapIds: string[] = [];

  if (!normalizedAtomId) {
    return buildAtomNotFoundResolution('<empty>', candidateMapIds, candidateMemberPaths);
  }

  if (!registryDoc?.entries || !Array.isArray(registryDoc.entries)) {
    return buildAtomNotFoundResolution(normalizedAtomId, candidateMapIds, candidateMemberPaths);
  }

  const atomEntry = findRegistryEntry(registryDoc, normalizedAtomId);
  const atomEntryVersions = extractVersionHistory(atomEntry);
  if (atomEntry && atomEntryVersions.length > 0) {
    return {
      ok: true,
      entry: {
        atomId: normalizedAtomId,
        versions: atomEntryVersions,
        sourceKind: 'atom-entry',
        sourceRef: atomEntry.lineageLogRef ?? atomEntry.versionLineage?.sourceRef ?? undefined,
        registryEntry: atomEntry
      }
    };
  }

  const atomEntryExistsWithoutHistory = Boolean(atomEntry);

  for (const entry of registryDoc.entries) {
    if (entry?.schemaId !== 'atm.atomicMap' || !Array.isArray(entry.members)) {
      continue;
    }

    const memberIndex = entry.members.findIndex((member: any) => member?.atomId === normalizedAtomId);
    if (memberIndex === -1) {
      continue;
    }

    candidateMapIds.push(String(entry.mapId ?? entry.id ?? '').trim() || '<unknown>');
    const member = entry.members[memberIndex];
    const lineageVersions = extractVersionLineageVersions(member?.versionLineage);
    if (lineageVersions.length > 0) {
      return {
        ok: true,
        entry: {
          atomId: normalizedAtomId,
          versions: lineageVersions,
          sourceKind: 'member-version-lineage',
          sourceRef: member.versionLineage?.sourceRef ?? entry.lineageLogRef ?? undefined,
          registryEntry: entry,
          memberIndex,
          mapId: entry.mapId ?? entry.id ?? undefined
        }
      };
    }

    candidateMemberPaths.push(buildMemberPath(entry.mapId ?? entry.id ?? '<unknown>', memberIndex));
  }

  if (candidateMemberPaths.length > 0 || candidateMapIds.length > 0) {
    return buildLineageMissingResolution(normalizedAtomId, candidateMapIds, candidateMemberPaths);
  }

  if (atomEntryExistsWithoutHistory) {
    return {
      ok: false,
      code: 'ATM_DIFF_LINEAGE_MISSING',
      summary: `Atom ${normalizedAtomId} exists in the registry, but no version history was available.`,
      advisory: `Backfill versions[] or member.versionLineage for ${normalizedAtomId} before running registry-diff.`,
      details: {
        atomId: normalizedAtomId,
        candidateMapIds: [],
        candidateMemberPaths: [],
        requiredContract: {
          field: 'members[].versionLineage',
          requiredProperties: ['currentVersion', 'versions'],
          note: 'Use real adopter lineage evidence; do not invent placeholder hash records.'
        }
      }
    };
  }

  return buildAtomNotFoundResolution(normalizedAtomId, candidateMapIds, candidateMemberPaths);
}

export function computeHashDiffReport(options: any) {
  const { entry, fromVersion, toVersion, driftReason } = options;
  const atomId = entry.atomId ?? entry.id;

  const fromRecord = findVersionRecord(entry, fromVersion);
  const toRecord = findVersionRecord(entry, toVersion);

  if (!fromRecord) {
    throw new Error(`Version ${fromVersion} not found in versions[] for ${atomId}`);
  }
  if (!toRecord) {
    throw new Error(`Version ${toVersion} not found in versions[] for ${atomId}`);
  }

  const specDelta = createHashDelta(fromRecord.specHash, toRecord.specHash);
  const codeDelta = createHashDelta(fromRecord.codeHash, toRecord.codeHash);
  const testDelta = createHashDelta(fromRecord.testHash, toRecord.testHash);

  const changedFields = [];
  if (specDelta.changed) changedFields.push('specHash');
  if (codeDelta.changed) changedFields.push('codeHash');
  if (testDelta.changed) changedFields.push('testHash');

  const lineageContinuity = checkLineageContinuity(entry, fromVersion, toVersion);
  const sfDelta = computeSemanticFingerprintDelta(fromRecord, toRecord);
  const resolvedDriftReason = driftReason ?? generateDefaultDriftReason(changedFields, fromVersion, toVersion);

  const report: any = {
    schemaId: 'atm.hashDiffReport',
    specVersion: '0.1.0',
    atomId,
    fromVersion,
    toVersion,
    generatedAt: new Date().toISOString(),
    deltas: {
      specHash: specDelta,
      codeHash: codeDelta,
      testHash: testDelta
    },
    driftSummary: {
      totalChanged: changedFields.length,
      changedFields,
      driftReason: resolvedDriftReason
    }
  };

  if (sfDelta) {
    report.semanticFingerprintDelta = sfDelta;
  }

  report.lineageContinuity = lineageContinuity;

  return report;
}

export function loadRegistryDocument(registryPath: any) {
  const resolvedPath = registryPath
    ? path.resolve(registryPath)
    : path.join(repoRoot, 'atomic-registry.json');

  if (!existsSync(resolvedPath)) {
    throw new Error(`Registry file not found: ${resolvedPath}`);
  }

  return JSON.parse(readFileSync(resolvedPath, 'utf8'));
}

function extractVersionHistory(entry: any) {
  if (!entry || typeof entry !== 'object') {
    return [];
  }

  if (Array.isArray(entry.versions) && entry.versions.length > 0) {
    return entry.versions.map((versionRecord: any) => normalizeVersionRecord(versionRecord)).filter((record: any) => record.version.length > 0);
  }

  if (entry.versionLineage && Array.isArray(entry.versionLineage.versions) && entry.versionLineage.versions.length > 0) {
    return entry.versionLineage.versions.map((versionRecord: any) => normalizeVersionRecord(versionRecord)).filter((record: any) => record.version.length > 0);
  }

  return [];
}

function extractVersionLineageVersions(versionLineage: any) {
  if (!versionLineage || typeof versionLineage !== 'object' || Array.isArray(versionLineage)) {
    return [];
  }
  if (!Array.isArray(versionLineage.versions) || versionLineage.versions.length === 0) {
    return [];
  }
  return versionLineage.versions.map((versionRecord: any) => normalizeVersionRecord(versionRecord)).filter((record: any) => record.version.length > 0);
}

function normalizeVersionRecord(versionRecord: any) {
  const normalized: any = {
    version: String(versionRecord?.version ?? '').trim(),
    specHash: String(versionRecord?.specHash ?? '').trim(),
    codeHash: String(versionRecord?.codeHash ?? '').trim(),
    testHash: String(versionRecord?.testHash ?? '').trim(),
    timestamp: String(versionRecord?.timestamp ?? '').trim()
  };

  if (versionRecord?.semanticFingerprint === null) {
    normalized.semanticFingerprint = null;
  } else if (typeof versionRecord?.semanticFingerprint === 'string' && versionRecord.semanticFingerprint.trim().length > 0) {
    normalized.semanticFingerprint = String(versionRecord.semanticFingerprint).trim();
  }

  return normalized;
}

function buildAtomNotFoundResolution(atomId: string, candidateMapIds: readonly string[], candidateMemberPaths: readonly string[]): RegistryDiffResolutionFailure {
  return {
    ok: false,
    code: 'ATM_DIFF_ATOM_NOT_FOUND',
    summary: `Atom ${atomId} not found in registry.`,
    advisory: `Add the atom as a registry entry or backfill member.versionLineage for the map member that owns ${atomId}.`,
    details: {
      atomId,
      candidateMapIds: [...new Set(candidateMapIds)],
      candidateMemberPaths: [...new Set(candidateMemberPaths)],
      requiredContract: {
        field: 'members[].versionLineage',
        requiredProperties: ['currentVersion', 'versions'],
        note: 'Backfill from real adopter lineage evidence; do not fabricate hash records.'
      }
    }
  };
}

function buildLineageMissingResolution(atomId: string, candidateMapIds: readonly string[], candidateMemberPaths: readonly string[]): RegistryDiffResolutionFailure {
  const uniqueMapIds = [...new Set(candidateMapIds)];
  const uniqueMemberPaths = [...new Set(candidateMemberPaths)];
  return {
    ok: false,
    code: 'ATM_DIFF_LINEAGE_MISSING',
    summary: `Atom ${atomId} was found through a map member, but no version lineage was available.`,
    advisory: `Backfill members[].versionLineage with the real currentVersion and versions history before running registry-diff for ${atomId}.`,
    details: {
      atomId,
      candidateMapIds: uniqueMapIds,
      candidateMemberPaths: uniqueMemberPaths,
      requiredContract: {
        field: 'members[].versionLineage',
        requiredProperties: ['currentVersion', 'versions'],
        note: 'Use adopter evidence to populate the lineage history, not synthetic placeholder hashes.'
      }
    }
  };
}

function createHashDelta(fromHash: any, toHash: any) {
  return {
    from: fromHash,
    to: toHash,
    changed: fromHash !== toHash
  };
}

function checkLineageContinuity(entry: any, fromVersion: any, toVersion: any) {
  if (!entry.versions || entry.versions.length < 2) {
    return true;
  }

  const sortedVersions = [...entry.versions]
    .map((v) => v.version)
    .sort(compareSemver);

  const fromIndex = sortedVersions.indexOf(fromVersion);
  const toIndex = sortedVersions.indexOf(toVersion);

  if (fromIndex === -1 || toIndex === -1) {
    return false;
  }

  return true;
}

function computeSemanticFingerprintDelta(fromRecord: any, toRecord: any) {
  const fromSf = fromRecord.semanticFingerprint ?? null;
  const toSf = toRecord.semanticFingerprint ?? null;

  if (fromSf === null && toSf === null) {
    return null;
  }

  return {
    from: fromSf,
    to: toSf,
    changed: fromSf !== toSf
  };
}

function generateDefaultDriftReason(changedFields: any, fromVersion: any, toVersion: any) {
  if (changedFields.length === 0) {
    return `No hash changes detected between ${fromVersion} and ${toVersion}.`;
  }
  const fieldList = changedFields.join(', ');
  return `Hash drift detected in ${fieldList} between ${fromVersion} and ${toVersion}.`;
}

function compareSemver(a: any, b: any) {
  const pa = String(a ?? '').split('.').map(Number);
  const pb = String(b ?? '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

function buildMemberPath(mapId: string, memberIndex: number) {
  return `${mapId}#members[${memberIndex}]`;
}

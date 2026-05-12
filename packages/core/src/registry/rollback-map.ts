import { existsSync } from 'node:fs';
import path from 'node:path';
import type { MapRegistryEntryRecord, RegistryEntryRecord } from '../index.ts';
import type {
  ResolveMapWorkbenchPathOptions,
  RollbackMapWorkbenchResolution,
  RollbackMemberAtomProof
} from './rollback-types.ts';
import { findVersionRecord, isAtomEntry, toPortablePath } from './rollback-registry-helpers.ts';

export function resolveMapWorkbenchPath(options: ResolveMapWorkbenchPathOptions): RollbackMapWorkbenchResolution {
  const canonicalPath = toPortablePath(path.join(options.repositoryRoot, 'atomic_workbench', 'maps', options.mapId));
  const owner = (options.mapOwner ?? 'shared').trim() || 'shared';
  const legacyPath = toPortablePath(path.join(options.repositoryRoot, 'atoms', owner, 'map', options.mapId));
  const canonicalExists = existsSync(path.join(options.repositoryRoot, 'atomic_workbench', 'maps', options.mapId));

  return {
    canonicalPath,
    legacyPath,
    selectedPath: canonicalExists ? canonicalPath : legacyPath,
    selectedSource: canonicalExists ? 'canonical' : 'legacy'
  };
}

export function buildMemberAtomProofs(options: {
  readonly entries: readonly (RegistryEntryRecord | MapRegistryEntryRecord)[];
  readonly memberSnapshot: readonly Record<string, unknown>[];
}): RollbackMemberAtomProof[] {
  const proofs: RollbackMemberAtomProof[] = [];
  for (const snapshot of options.memberSnapshot) {
    const atomId = String(snapshot.atomId ?? '').trim();
    const version = String(snapshot.version ?? '').trim();
    const atomEntry = options.entries.find((entry) => isAtomEntry(entry) && entry.atomId === atomId) as RegistryEntryRecord | undefined;
    const versionRecord = atomEntry ? findVersionRecord(atomEntry, version) : null;

    const expected = {
      specHash: String(snapshot.specHash ?? versionRecord?.specHash ?? ''),
      codeHash: String(snapshot.codeHash ?? versionRecord?.codeHash ?? ''),
      testHash: String(snapshot.testHash ?? versionRecord?.testHash ?? '')
    };
    const actual = {
      specHash: String(versionRecord?.specHash ?? ''),
      codeHash: String(versionRecord?.codeHash ?? ''),
      testHash: String(versionRecord?.testHash ?? '')
    };
    const matched = expected.specHash === actual.specHash
      && expected.codeHash === actual.codeHash
      && expected.testHash === actual.testHash
      && expected.specHash.length > 0
      && expected.codeHash.length > 0
      && expected.testHash.length > 0;

    proofs.push({
      atomId,
      version,
      expected,
      actual,
      matched
    });
  }
  return proofs;
}

export function resolveTargetMapSnapshot(
  mapEntry: MapRegistryEntryRecord & Record<string, unknown>,
  toVersion: string
): {
  readonly mapHash: string;
  readonly members: readonly { atomId: string; version: string }[];
  readonly memberSnapshot: readonly Record<string, unknown>[];
  readonly status?: string;
  readonly semanticFingerprint?: string | null;
  readonly mapGeneratorProvenance: boolean;
} | null {
  const versions = Array.isArray(mapEntry.versions) ? mapEntry.versions as Array<Record<string, unknown>> : [];
  const target = versions.find((entry) => String(entry.version ?? '') === toVersion);
  if (target) {
    const members = normalizeMapMembers(target.members ?? mapEntry.members);
    const memberSnapshot = normalizeMemberSnapshot(target.memberSnapshot ?? members);
    return {
      mapHash: String(target.mapHash ?? mapEntry.mapHash ?? ''),
      members,
      memberSnapshot,
      status: target.status ? String(target.status) : undefined,
      semanticFingerprint: target.semanticFingerprint ? String(target.semanticFingerprint) : null,
      mapGeneratorProvenance: Boolean(target.mapGeneratorProvenance ?? mapEntry.mapGeneratorProvenance)
    };
  }

  if (String(mapEntry.mapVersion ?? mapEntry.currentVersion ?? '') !== toVersion) {
    return null;
  }

  const members = normalizeMapMembers(mapEntry.members);
  return {
    mapHash: String(mapEntry.mapHash ?? ''),
    members,
    memberSnapshot: normalizeMemberSnapshot(mapEntry.memberSnapshot ?? members),
    status: mapEntry.status ? String(mapEntry.status) : undefined,
    semanticFingerprint: mapEntry.semanticFingerprint ? String(mapEntry.semanticFingerprint) : null,
    mapGeneratorProvenance: Boolean(mapEntry.mapGeneratorProvenance)
  };
}

function normalizeMapMembers(value: unknown): readonly { atomId: string; version: string }[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => ({
    atomId: String((entry as Record<string, unknown>).atomId ?? ''),
    version: String((entry as Record<string, unknown>).version ?? '')
  }));
}

function normalizeMemberSnapshot(value: unknown): readonly Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => ({ ...(entry as Record<string, unknown>) }));
}


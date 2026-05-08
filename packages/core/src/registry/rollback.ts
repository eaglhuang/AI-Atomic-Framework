import { existsSync } from 'node:fs';
import path from 'node:path';
import type { MapRegistryEntryRecord, RegistryDocument, RegistryEntryRecord } from '../index';

export const behaviorRollbackContract = Object.freeze({
  'behavior.evolve': 'behavior.rollback-evolve',
  'behavior.merge': 'behavior.rollback-merge',
  'behavior.atomize': 'behavior.rollback-atomize',
  'behavior.infect': 'behavior.rollback-infect'
} as const);

export type RollbackTargetKind = 'atom' | 'map';

export interface RollbackHashesVerified {
  readonly spec: boolean;
  readonly code: boolean;
  readonly test: boolean;
  readonly allVerified: boolean;
}

export interface RollbackMemberAtomProof {
  readonly atomId: string;
  readonly version: string;
  readonly expected: {
    readonly specHash: string;
    readonly codeHash: string;
    readonly testHash: string;
  };
  readonly actual: {
    readonly specHash: string;
    readonly codeHash: string;
    readonly testHash: string;
  };
  readonly matched: boolean;
}

export interface RollbackMapWorkbenchResolution {
  readonly canonicalPath: string;
  readonly legacyPath: string;
  readonly selectedPath: string;
  readonly selectedSource: 'canonical' | 'legacy';
}

export interface RollbackProof {
  readonly schemaId: 'atm.rollbackProof';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly proofId: string;
  readonly targetKind: RollbackTargetKind;
  readonly atomId?: string;
  readonly mapId?: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly behaviorId: string;
  readonly reverseBehaviorId: string;
  readonly rollbackContractSymmetric: boolean;
  readonly hashesVerified: RollbackHashesVerified;
  readonly verifiedAt: string;
  readonly statusReverted: boolean;
  readonly semanticFingerprintReverted: boolean;
  readonly verificationStatus: 'passed' | 'failed';
  readonly failureReason?: string;
  readonly memberAtomProofs?: readonly RollbackMemberAtomProof[];
  readonly mapGeneratorProvenance?: boolean;
  readonly mapWorkbenchResolution?: RollbackMapWorkbenchResolution;
}

export interface RollbackProofValidationResult {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

export interface ResolveMapWorkbenchPathOptions {
  readonly repositoryRoot: string;
  readonly mapId: string;
  readonly mapOwner?: string;
}

export interface ApplyRegistryRollbackOptions {
  readonly registryDocument: RegistryDocument;
  readonly targetKind: RollbackTargetKind;
  readonly atomId?: string;
  readonly mapId?: string;
  readonly toVersion: string;
  readonly behaviorId: string;
  readonly repositoryRoot: string;
  readonly mapOwner?: string;
  readonly verifiedAt?: string;
}

export interface ApplyRegistryRollbackResult {
  readonly updatedRegistryDocument: RegistryDocument;
  readonly proof: RollbackProof;
}

export function resolveRollbackBehavior(behaviorId: string) {
  return behaviorRollbackContract[behaviorId as keyof typeof behaviorRollbackContract] ?? null;
}

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

export function validateRollbackProof(proof: RollbackProof): RollbackProofValidationResult {
  const issues: string[] = [];
  if (!proof.rollbackContractSymmetric) {
    issues.push('rollback contract is not symmetric for the provided behaviorId.');
  }
  if (!proof.hashesVerified.allVerified || !proof.hashesVerified.spec || !proof.hashesVerified.code || !proof.hashesVerified.test) {
    issues.push('spec/code/test hash verification failed.');
  }
  if (!proof.statusReverted) {
    issues.push('status was not reverted to the target version snapshot.');
  }
  if (!proof.semanticFingerprintReverted) {
    issues.push('semanticFingerprint was not reverted to the target version snapshot.');
  }
  if (proof.targetKind === 'map') {
    const memberProofs = proof.memberAtomProofs ?? [];
    if (memberProofs.length === 0) {
      issues.push('map rollback proof must include memberAtomProofs.');
    }
    if (memberProofs.some((entry) => !entry.matched)) {
      issues.push('at least one map member atom hash proof mismatched.');
    }
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

export function applyRegistryRollback(options: ApplyRegistryRollbackOptions): ApplyRegistryRollbackResult {
  const reverseBehaviorId = resolveRollbackBehavior(options.behaviorId);
  if (!reverseBehaviorId) {
    throw new Error(`Unsupported behaviorId for rollback contract: ${options.behaviorId}`);
  }

  const verifiedAt = options.verifiedAt ?? new Date().toISOString();
  const clonedRegistry = cloneJson(options.registryDocument) as RegistryDocument;
  const entries = [...clonedRegistry.entries] as Array<RegistryEntryRecord | MapRegistryEntryRecord>;
  if (entries.length === 0) {
    throw new Error('Registry has no entries.');
  }

  if (options.targetKind === 'atom') {
    if (!options.atomId) {
      throw new Error('atom rollback requires atomId.');
    }

    const entryIndex = entries.findIndex((entry) => isAtomEntry(entry) && entry.atomId === options.atomId);
    if (entryIndex < 0) {
      throw new Error(`Atom entry not found: ${options.atomId}`);
    }

    const entry = entries[entryIndex] as RegistryEntryRecord & Record<string, unknown>;
    const fromVersion = entry.currentVersion ?? entry.atomVersion;
    if (!fromVersion) {
      throw new Error(`Atom entry ${entry.atomId} is missing currentVersion/atomVersion.`);
    }

    const targetVersionRecord = findVersionRecord(entry, options.toVersion);
    if (!targetVersionRecord) {
      throw new Error(`Target version ${options.toVersion} not found in versions[] for ${entry.atomId}.`);
    }

    const targetStatus = String((targetVersionRecord as Record<string, unknown>).status ?? entry.status);
    const targetSemanticFingerprint = (targetVersionRecord as Record<string, unknown>).semanticFingerprint ?? entry.semanticFingerprint ?? null;

    const updatedEntry = {
      ...entry,
      atomVersion: options.toVersion,
      currentVersion: options.toVersion,
      hashLock: {
        ...entry.hashLock,
        digest: targetVersionRecord.specHash
      },
      status: targetStatus as RegistryEntryRecord['status'],
      selfVerification: {
        ...entry.selfVerification,
        specHash: targetVersionRecord.specHash,
        codeHash: targetVersionRecord.codeHash,
        testHash: targetVersionRecord.testHash
      },
      semanticFingerprint: targetSemanticFingerprint ?? undefined
    } as RegistryEntryRecord & Record<string, unknown>;
    entries[entryIndex] = updatedEntry as unknown as RegistryEntryRecord;

    const hashesVerified = {
      spec: updatedEntry.selfVerification.specHash === targetVersionRecord.specHash,
      code: updatedEntry.selfVerification.codeHash === targetVersionRecord.codeHash,
      test: updatedEntry.selfVerification.testHash === targetVersionRecord.testHash,
      allVerified: false
    };
    hashesVerified.allVerified = hashesVerified.spec && hashesVerified.code && hashesVerified.test;

    const statusReverted = updatedEntry.status === targetStatus;
    const semanticFingerprintReverted = (updatedEntry.semanticFingerprint ?? null) === targetSemanticFingerprint;
    const proof = createProof({
      targetKind: 'atom',
      atomId: entry.atomId,
      fromVersion,
      toVersion: options.toVersion,
      behaviorId: options.behaviorId,
      reverseBehaviorId,
      hashesVerified,
      verifiedAt,
      statusReverted,
      semanticFingerprintReverted
    });

    return {
      updatedRegistryDocument: {
        ...clonedRegistry,
        generatedAt: verifiedAt,
        entries
      },
      proof
    };
  }

  if (!options.mapId) {
    throw new Error('map rollback requires mapId.');
  }

  const mapIndex = entries.findIndex((entry) => isMapEntry(entry) && entry.mapId === options.mapId);
  if (mapIndex < 0) {
    throw new Error(`Map entry not found: ${options.mapId}`);
  }
  const mapEntry = entries[mapIndex] as MapRegistryEntryRecord & Record<string, unknown>;
  const fromVersion = String(mapEntry.currentVersion ?? mapEntry.mapVersion ?? '');
  if (!fromVersion) {
    throw new Error(`Map entry ${options.mapId} is missing currentVersion/mapVersion.`);
  }

  const targetMapSnapshot = resolveTargetMapSnapshot(mapEntry, options.toVersion);
  if (!targetMapSnapshot) {
    throw new Error(`Target map version ${options.toVersion} not found for ${options.mapId}.`);
  }

  const memberAtomProofs = buildMemberAtomProofs({
    entries,
    memberSnapshot: targetMapSnapshot.memberSnapshot
  });
  const memberHashesOk = memberAtomProofs.every((entry) => entry.matched);
  const mapHashOk = String(targetMapSnapshot.mapHash).trim().length > 0;
  const hashesVerified = {
    spec: mapHashOk,
    code: memberHashesOk,
    test: memberHashesOk,
    allVerified: mapHashOk && memberHashesOk
  };

  const targetStatus = targetMapSnapshot.status ?? mapEntry.status ?? null;
  const targetSemanticFingerprint = targetMapSnapshot.semanticFingerprint ?? mapEntry.semanticFingerprint ?? null;

  const updatedMapEntry = {
    ...mapEntry,
    mapVersion: options.toVersion,
    currentVersion: options.toVersion,
    mapHash: targetMapSnapshot.mapHash,
    members: targetMapSnapshot.members,
    status: targetStatus ?? undefined,
    semanticFingerprint: targetSemanticFingerprint ?? undefined,
    mapGeneratorProvenance: targetMapSnapshot.mapGeneratorProvenance
  } as MapRegistryEntryRecord & Record<string, unknown>;

  entries[mapIndex] = updatedMapEntry as unknown as MapRegistryEntryRecord;
  const statusReverted = (updatedMapEntry.status ?? null) === targetStatus;
  const semanticFingerprintReverted = (updatedMapEntry.semanticFingerprint ?? null) === targetSemanticFingerprint;
  const mapWorkbenchResolution = resolveMapWorkbenchPath({
    repositoryRoot: options.repositoryRoot,
    mapId: options.mapId,
    mapOwner: options.mapOwner
  });
  const proof = createProof({
    targetKind: 'map',
    mapId: options.mapId,
    fromVersion,
    toVersion: options.toVersion,
    behaviorId: options.behaviorId,
    reverseBehaviorId,
    hashesVerified,
    verifiedAt,
    statusReverted,
    semanticFingerprintReverted,
    memberAtomProofs,
    mapGeneratorProvenance: targetMapSnapshot.mapGeneratorProvenance,
    mapWorkbenchResolution
  });

  return {
    updatedRegistryDocument: {
      ...clonedRegistry,
      generatedAt: verifiedAt,
      entries
    },
    proof
  };
}

function createProof(options: {
  readonly targetKind: RollbackTargetKind;
  readonly atomId?: string;
  readonly mapId?: string;
  readonly fromVersion: string;
  readonly toVersion: string;
  readonly behaviorId: string;
  readonly reverseBehaviorId: string;
  readonly hashesVerified: RollbackHashesVerified;
  readonly verifiedAt: string;
  readonly statusReverted: boolean;
  readonly semanticFingerprintReverted: boolean;
  readonly memberAtomProofs?: readonly RollbackMemberAtomProof[];
  readonly mapGeneratorProvenance?: boolean;
  readonly mapWorkbenchResolution?: RollbackMapWorkbenchResolution;
}): RollbackProof {
  const identity = options.targetKind === 'atom' ? options.atomId : options.mapId;
  const proofId = `rollback-proof.${options.targetKind}.${String(identity)}.${options.fromVersion}.to.${options.toVersion}`;
  const verificationStatus = options.hashesVerified.allVerified && options.statusReverted && options.semanticFingerprintReverted
    ? 'passed'
    : 'failed';

  return {
    schemaId: 'atm.rollbackProof',
    specVersion: '0.1.0',
    migration: {
      strategy: 'none',
      fromVersion: null,
      notes: 'Initial rollback proof contract.'
    },
    proofId,
    targetKind: options.targetKind,
    atomId: options.atomId,
    mapId: options.mapId,
    fromVersion: options.fromVersion,
    toVersion: options.toVersion,
    behaviorId: options.behaviorId,
    reverseBehaviorId: options.reverseBehaviorId,
    rollbackContractSymmetric: true,
    hashesVerified: options.hashesVerified,
    verifiedAt: options.verifiedAt,
    statusReverted: options.statusReverted,
    semanticFingerprintReverted: options.semanticFingerprintReverted,
    verificationStatus,
    failureReason: verificationStatus === 'failed' ? 'Rollback proof checks failed.' : undefined,
    memberAtomProofs: options.memberAtomProofs,
    mapGeneratorProvenance: options.mapGeneratorProvenance,
    mapWorkbenchResolution: options.mapWorkbenchResolution
  };
}

function buildMemberAtomProofs(options: {
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

function resolveTargetMapSnapshot(
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

function isAtomEntry(entry: RegistryEntryRecord | MapRegistryEntryRecord): entry is RegistryEntryRecord {
  return Object.hasOwn(entry, 'atomId');
}

function isMapEntry(entry: RegistryEntryRecord | MapRegistryEntryRecord): entry is MapRegistryEntryRecord {
  return Object.hasOwn(entry, 'mapId');
}

function findVersionRecord(entry: RegistryEntryRecord, version: string) {
  if (!entry.versions || !Array.isArray(entry.versions)) {
    return null;
  }
  return entry.versions.find((record) => record.version === version) ?? null;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function toPortablePath(value: string) {
  return value.replace(/\\/g, '/');
}
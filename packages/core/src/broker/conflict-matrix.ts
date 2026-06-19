import type { ActiveWriteIntent, BrokerDecision, ConflictDetail, WriteIntent, WriteIntentAtomRef } from './types.ts';

const conflictMatrixSchemaId = 'atm.brokerConflictMatrix.v1' as const;
const conflictMatrixSpecVersion = '0.1.0' as const;

export type BrokerArbitrationVerdict = 'allow' | 'watch' | 'freeze' | 'takeover';

export interface BrokerConflictClassResult {
  readonly kind: 'shared-surface' | 'cid' | 'read-set' | 'file-range' | 'intent-shape' | 'lease';
  readonly detail: string;
  readonly blockingTask: string;
}

export interface BrokerConflictMatrix {
  readonly schemaId: 'atm.brokerConflictMatrix.v1';
  readonly specVersion: '0.1.0';
  readonly migration: BrokerDecision['migration'];
  readonly taskId: string;
  readonly arbitrationVerdict: BrokerArbitrationVerdict;
  readonly conflicts: readonly BrokerConflictClassResult[];
}

export function evaluateConflictMatrix(
  newIntent: WriteIntent,
  activeIntents: readonly ActiveWriteIntent[],
  options: {
    readonly currentEpoch?: number;
  } = {}
): BrokerConflictMatrix {
  const conflicts: BrokerConflictClassResult[] = [];

  if (!isWellFormedIntent(newIntent)) {
    conflicts.push({
      kind: 'intent-shape',
      detail: 'Malformed intent shape: missing taskId / actorId / atomRefs / targetFiles.',
      blockingTask: 'self'
    });
  }

  const sharedSurfaceConflicts = detectSharedSurfaceConflicts(newIntent, activeIntents);
  conflicts.push(...sharedSurfaceConflicts);

  const cidConflicts = detectCidConflictClasses(newIntent, activeIntents);
  conflicts.push(...cidConflicts);

  const fileConflicts = detectFileRangeConflictClasses(newIntent, activeIntents);
  conflicts.push(...fileConflicts);

  const leaseConflicts = detectLeaseConflicts(activeIntents, options.currentEpoch);
  conflicts.push(...leaseConflicts);

  const arbitrationVerdict = chooseArbitrationVerdict(conflicts);

  return {
    schemaId: conflictMatrixSchemaId,
    specVersion: conflictMatrixSpecVersion,
    migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
    taskId: newIntent.taskId,
    arbitrationVerdict,
    conflicts: dedupeConflictResults(conflicts)
  };
}

function isWellFormedIntent(intent: WriteIntent): boolean {
  if (!intent.taskId || !intent.actorId || intent.targetFiles.length === 0 || intent.atomRefs.length === 0) {
    return false;
  }

  for (const ref of intent.atomRefs) {
    if (!ref.atomId || !ref.atomCid) {
      return false;
    }
  }

  return true;
}

function chooseArbitrationVerdict(conflicts: readonly BrokerConflictClassResult[]): BrokerArbitrationVerdict {
  if (conflicts.some((item) => item.kind === 'intent-shape' || item.kind === 'lease')) {
    return 'takeover';
  }

  const hasHardConflict = conflicts.some((item) => item.kind === 'shared-surface' || item.kind === 'cid');
  if (hasHardConflict) {
    return 'freeze';
  }

  const hasFileConflict = conflicts.some((item) => item.kind === 'file-range');
  if (hasFileConflict) {
    return conflicts.some((item) => item.detail.includes('overlap')) ? 'freeze' : 'watch';
  }

  const hasReadConflict = conflicts.some((item) => item.kind === 'read-set');
  return hasReadConflict ? 'watch' : 'allow';
}

function detectSharedSurfaceConflicts(
  newIntent: WriteIntent,
  activeIntents: readonly ActiveWriteIntent[]
): BrokerConflictClassResult[] {
  const conflicts: BrokerConflictClassResult[] = [];
  const newGenerators = new Set(newIntent.sharedSurfaces.generators);
  const newProjections = new Set(newIntent.sharedSurfaces.projections);
  const newRegistries = new Set(newIntent.sharedSurfaces.registries);
  const newValidators = new Set(newIntent.sharedSurfaces.validators);
  const newArtifacts = new Set(newIntent.sharedSurfaces.artifacts);

  for (const active of activeIntents) {
    if (active.taskId === newIntent.taskId) continue;

    for (const generator of active.resourceKeys.generators) {
      if (newGenerators.has(generator)) {
        conflicts.push({
          kind: 'shared-surface',
          detail: `Shared generator conflict: '${generator}' is in use by '${active.taskId}'.`,
          blockingTask: active.taskId
        });
      }
    }

    for (const projection of newProjections) {
      if (active.resourceKeys.projections.includes(projection)) {
        conflicts.push({
          kind: 'shared-surface',
          detail: `Shared projection conflict: '${projection}' is in use by '${active.taskId}'.`,
          blockingTask: active.taskId
        });
      }
    }

    for (const registry of newRegistries) {
      if (active.resourceKeys.registries.includes(registry)) {
        conflicts.push({
          kind: 'shared-surface',
          detail: `Shared registry conflict: '${registry}' is in use by '${active.taskId}'.`,
          blockingTask: active.taskId
        });
      }
    }

    for (const validator of newValidators) {
      if (active.resourceKeys.validators.includes(validator)) {
        conflicts.push({
          kind: 'shared-surface',
          detail: `Shared validator conflict: '${validator}' is in use by '${active.taskId}'.`,
          blockingTask: active.taskId
        });
      }
    }

    for (const artifact of newArtifacts) {
      if (active.resourceKeys.artifacts.includes(artifact)) {
        conflicts.push({
          kind: 'shared-surface',
          detail: `Shared artifact conflict: '${artifact}' is in use by '${active.taskId}'.`,
          blockingTask: active.taskId
        });
      }
    }
  }

  return conflicts;
}

function detectCidConflictClasses(
  newIntent: WriteIntent,
  activeIntents: readonly ActiveWriteIntent[]
): BrokerConflictClassResult[] {
  const conflicts: BrokerConflictClassResult[] = [];

  const newAtomIds = new Set(newIntent.atomRefs.map((ref) => ref.atomId));
  const newAtomCids = new Set(newIntent.atomRefs.map((ref) => ref.atomCid));
  const newReadAtomIds = new Set((newIntent.readAtoms ?? []).map((ref) => ref.atomId));
  const newReadAtomCids = new Set((newIntent.readAtoms ?? []).map((ref) => ref.atomCid));
  const seen = new Set<string>();

  for (const active of activeIntents) {
    if (active.taskId === newIntent.taskId) continue;

    for (const activeAtomId of active.resourceKeys.atomIds) {
      if (newAtomIds.has(activeAtomId)) {
        const key = `cid:${active.taskId}:${activeAtomId}`;
        if (!seen.has(key)) {
          conflicts.push({
            kind: 'cid',
            detail: `Write set overlap: atomId '${activeAtomId}' is held by '${active.taskId}'.`,
            blockingTask: active.taskId
          });
          seen.add(key);
        }
      }
      if (newReadAtomIds.has(activeAtomId)) {
        const key = `read:${active.taskId}:${activeAtomId}`;
        if (!seen.has(key)) {
          conflicts.push({
            kind: 'read-set',
            detail: `Read/write overlap: atomId '${activeAtomId}' is written by '${active.taskId}'.`,
            blockingTask: active.taskId
          });
          seen.add(key);
        }
      }
    }

    for (const activeAtomCid of active.resourceKeys.atomCids) {
      if (newAtomCids.has(activeAtomCid)) {
        const key = `cid-c:${active.taskId}:${activeAtomCid}`;
        if (!seen.has(key)) {
          conflicts.push({
            kind: 'cid',
            detail: `Write set overlap: atomCid '${activeAtomCid}' is held by '${active.taskId}'.`,
            blockingTask: active.taskId
          });
          seen.add(key);
        }
      }
      if (newReadAtomCids.has(activeAtomCid)) {
        const key = `read-c:${active.taskId}:${activeAtomCid}`;
        if (!seen.has(key)) {
          conflicts.push({
            kind: 'read-set',
            detail: `Read/write overlap: atomCid '${activeAtomCid}' is written by '${active.taskId}'.`,
            blockingTask: active.taskId
          });
          seen.add(key);
        }
      }
    }
  }

  return conflicts;
}

function detectFileRangeConflictClasses(
  newIntent: WriteIntent,
  activeIntents: readonly ActiveWriteIntent[]
): BrokerConflictClassResult[] {
  const conflicts: BrokerConflictClassResult[] = [];
  const seen = new Set<string>();

  const activeRangesByFile = new Map<string, { active: ActiveWriteIntent; ref: WriteIntentAtomRef; range: { filePath: string; lineStart: number; lineEnd: number } }[]>();

  for (const active of activeIntents) {
    if (active.taskId === newIntent.taskId) continue;
    for (const atomRange of active.resourceKeys.atomRanges ?? []) {
      if (!atomRange.filePath || atomRange.lineStart <= 0 || atomRange.lineEnd <= 0) continue;
      const existing = activeRangesByFile.get(atomRange.filePath) ?? [];
      existing.push({ active, ref: { atomId: active.taskId, atomCid: atomRange.atomCid, operation: 'modify' }, range: atomRange });
      activeRangesByFile.set(atomRange.filePath, existing);
    }
  }

  for (const targetFile of newIntent.targetFiles) {
    const sourceRanges = newIntent.atomRefs
      .map((entry) => ({ entry, range: entry.sourceRange }))
      .filter((candidate): candidate is { entry: WriteIntentAtomRef; range: NonNullable<WriteIntentAtomRef['sourceRange']> } => {
        const range = candidate.range;
        return !!range && range.filePath === targetFile && range.lineStart > 0 && range.lineEnd > 0;
      });

    if (sourceRanges.length === 0) continue;

    const activeEntries = activeRangesByFile.get(targetFile) ?? [];
    if (activeEntries.length === 0) continue;

    for (const source of sourceRanges) {
      for (const active of activeEntries) {
        if (source.range.lineStart <= active.range.lineEnd && source.range.lineEnd >= active.range.lineStart) {
          const overlapKey = `overlap:${targetFile}:${active.active.taskId}:${source.entry.atomCid}:${active.ref.atomCid}`;
          if (!seen.has(overlapKey)) {
            conflicts.push({
              kind: 'file-range',
              detail: `File overlap on '${targetFile}' between '${source.entry.atomCid}' and '${active.ref.atomCid}'.`,
              blockingTask: active.active.taskId
            });
            seen.add(overlapKey);
          }
        } else {
          const watchKey = `disjoint:${targetFile}:${active.active.taskId}:${source.entry.atomCid}:${active.ref.atomCid}`;
          if (!seen.has(watchKey)) {
            conflicts.push({
              kind: 'file-range',
              detail: `Syntactically disjoint on '${targetFile}' with active task '${active.active.taskId}'.`,
              blockingTask: active.active.taskId
            });
            seen.has(watchKey) || seen.add(watchKey);
          }
        }
      }
    }
  }

  return conflicts;
}

function detectLeaseConflicts(
  activeIntents: readonly ActiveWriteIntent[],
  currentEpoch?: number
): BrokerConflictClassResult[] {
  const conflicts: BrokerConflictClassResult[] = [];
  const now = Date.now();

  for (const active of activeIntents) {
    if (typeof currentEpoch === 'number' && Number.isFinite(currentEpoch) && active.leaseEpoch < currentEpoch) {
      conflicts.push({
        kind: 'lease',
        detail: `Active lease epoch stale for '${active.taskId}'; leaseEpoch ${active.leaseEpoch} is behind registry currentEpoch ${currentEpoch}.`,
        blockingTask: active.taskId
      });
      continue;
    }
    if (!active.expiresAt) continue;
    const expiresAt = Date.parse(active.expiresAt);
    if (Number.isNaN(expiresAt) || expiresAt <= now) {
      conflicts.push({
        kind: 'lease',
        detail: `Active lease expired for '${active.taskId}'; stale entry requires takeover.`,
        blockingTask: active.taskId
      });
    }
  }

  return dedupeConflictResults(conflicts);
}

function dedupeConflictResults(conflicts: readonly BrokerConflictClassResult[]): BrokerConflictClassResult[] {
  const seen = new Set<string>();
  const unique: BrokerConflictClassResult[] = [];
  for (const conflict of conflicts) {
    const key = `${conflict.kind}::${conflict.blockingTask}::${conflict.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(conflict);
  }

  return unique.sort((left, right) => {
    const leftKey = `${left.kind}::${left.blockingTask}::${left.detail}`;
    const rightKey = `${right.kind}::${right.blockingTask}::${right.detail}`;
    return leftKey.localeCompare(rightKey);
  });
}

import type {
  EvolutionEvidencePatternEntry,
  PolymorphPoliceSignalKind,
  RollbackPoliceSignalKind
} from './types.ts';
import type { SourceInventoryEntry } from '../source-inventory/source-inventory.ts';

export const DEFAULT_POLYMORPH_VARIANT_THRESHOLD = 12;

export function buildPolymorphSuppressionKey(input: {
  readonly templateId: string;
  readonly signalKind: PolymorphPoliceSignalKind;
  readonly instanceId?: string;
  readonly templateVersion?: string;
}): string {
  return [
    'polymorph',
    input.templateId,
    input.signalKind,
    input.instanceId ?? '*',
    input.templateVersion ?? 'no-base'
  ].join('::');
}

export function buildRollbackSuppressionKey(input: {
  readonly proposalId: string;
  readonly signalKind: RollbackPoliceSignalKind;
  readonly baseVersion?: string;
}): string {
  return ['rollback', input.proposalId, input.signalKind, input.baseVersion ?? 'no-base'].join('::');
}

export function buildEvolutionSuppressionKey(entry: EvolutionEvidencePatternEntry): string {
  const tags = (entry.patternTags ?? []).slice().sort().join('|');
  const targetId = entry.atomId ?? entry.atomMapId ?? 'unknown';
  const baseVersion = entry.baseAtomVersion ?? entry.baseMapVersion ?? 'no-base';
  return [entry.targetSurface, targetId, entry.signalKind, tags, baseVersion, 'evolution'].join('::');
}

export function buildDecompositionSuppressionKey(entry: SourceInventoryEntry): string {
  return ['source-surface', entry.legacyUri ?? entry.filePath, 'oversized-source-surface', 'decomposition'].join('::');
}

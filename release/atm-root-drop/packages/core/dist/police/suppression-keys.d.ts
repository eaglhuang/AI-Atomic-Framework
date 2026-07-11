import type { EvolutionEvidencePatternEntry, PolymorphPoliceSignalKind, RollbackPoliceSignalKind } from './types.ts';
import type { SourceInventoryEntry } from '../source-inventory/source-inventory.ts';
export declare const DEFAULT_POLYMORPH_VARIANT_THRESHOLD = 12;
export declare function buildPolymorphSuppressionKey(input: {
    readonly templateId: string;
    readonly signalKind: PolymorphPoliceSignalKind;
    readonly instanceId?: string;
    readonly templateVersion?: string;
}): string;
export declare function buildRollbackSuppressionKey(input: {
    readonly proposalId: string;
    readonly signalKind: RollbackPoliceSignalKind;
    readonly baseVersion?: string;
}): string;
export declare function buildEvolutionSuppressionKey(entry: EvolutionEvidencePatternEntry): string;
export declare function buildDecompositionSuppressionKey(entry: SourceInventoryEntry): string;

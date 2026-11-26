import type { RegistryMapEdgeRecord, RegistryMapMemberRecord, RegistryMapQualityTargetsRecord, AtomicMapReplacementRecord } from '../index.js';
export { createAtomicMapSemanticFingerprint } from './semantic-fingerprint.js';
export interface AtomicMapHashInput {
    readonly members: readonly RegistryMapMemberRecord[];
    readonly edges: readonly RegistryMapEdgeRecord[];
    readonly entrypoints: readonly string[];
    readonly qualityTargets?: RegistryMapQualityTargetsRecord;
    readonly replacement?: AtomicMapReplacementRecord;
}
export declare function createAtomicMapHashPayload(input: AtomicMapHashInput): {
    replacement?: {
        legacyUris: string[];
    };
    members: {
        role?: string;
        atomId: string;
        version: string;
    }[];
    edges: {
        edgeKind?: string;
        from: string;
        to: string;
        binding: string;
    }[];
    entrypoints: string[];
};
export declare function computeAtomicMapHash(input: AtomicMapHashInput): string;

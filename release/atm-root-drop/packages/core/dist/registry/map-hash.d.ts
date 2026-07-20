import type { RegistryMapEdgeRecord, RegistryMapMemberRecord, RegistryMapQualityTargetsRecord, AtomicMapReplacementRecord } from '../index';
export { createAtomicMapSemanticFingerprint } from './semantic-fingerprint.ts';
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
    } | undefined;
    members: {
        role?: string | undefined;
        atomId: string;
        version: string;
    }[];
    edges: {
        edgeKind?: string | undefined;
        from: string;
        to: string;
        binding: string;
    }[];
    entrypoints: string[];
};
export declare function computeAtomicMapHash(input: AtomicMapHashInput): string;

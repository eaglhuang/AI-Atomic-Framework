import type { MapRegistryEntryRecord, RegistryEntryRecord } from '../index.ts';
import type { ResolveMapWorkbenchPathOptions, RollbackMapWorkbenchResolution, RollbackMemberAtomProof } from './rollback-types.ts';
export declare function resolveMapWorkbenchPath(options: ResolveMapWorkbenchPathOptions): RollbackMapWorkbenchResolution;
export declare function buildMemberAtomProofs(options: {
    readonly entries: readonly (RegistryEntryRecord | MapRegistryEntryRecord)[];
    readonly memberSnapshot: readonly Record<string, unknown>[];
}): RollbackMemberAtomProof[];
export declare function resolveTargetMapSnapshot(mapEntry: MapRegistryEntryRecord & Record<string, unknown>, toVersion: string): {
    readonly mapHash: string;
    readonly members: readonly {
        atomId: string;
        version: string;
    }[];
    readonly memberSnapshot: readonly Record<string, unknown>[];
    readonly status?: string;
    readonly semanticFingerprint?: string | null;
    readonly mapGeneratorProvenance: boolean;
} | null;

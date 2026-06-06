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
export declare function findRegistryEntry(registryDoc: any, atomId: any): any;
export declare function findVersionRecord(entry: any, version: any): any;
export declare function resolveRegistryDiffTarget(registryDoc: any, atomId: any): RegistryDiffResolution;
export declare function computeHashDiffReport(options: any): any;
export declare function loadRegistryDocument(registryPath: any): any;

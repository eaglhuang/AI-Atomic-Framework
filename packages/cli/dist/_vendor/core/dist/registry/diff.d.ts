interface VersionRecord {
    version: string;
    specHash: string;
    codeHash: string;
    testHash: string;
    timestamp: string;
    semanticFingerprint?: string | null;
}
interface VersionLineage {
    versions?: VersionRecord[];
    sourceRef?: string;
    currentVersion?: string;
}
interface RegistryAtomEntry {
    atomId?: string;
    id?: string;
    versions?: VersionRecord[];
    versionLineage?: VersionLineage;
    lineageLogRef?: string;
    schemaId?: string;
    members?: RegistryMapMember[];
    mapId?: string;
}
interface RegistryMapMember {
    atomId?: string;
    versionLineage?: VersionLineage;
}
interface RegistryDocument {
    entries?: RegistryAtomEntry[];
}
interface HashDiffReportOptions {
    entry: RegistryAtomEntry;
    fromVersion: string;
    toVersion: string;
    driftReason?: string;
}
export interface RegistryDiffResolvedEntry {
    readonly atomId: string;
    readonly versions: readonly VersionRecord[];
    readonly sourceKind: 'atom-entry' | 'member-version-lineage';
    readonly sourceRef?: string;
    readonly registryEntry?: RegistryAtomEntry;
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
export declare function findRegistryEntry(registryDoc: RegistryDocument | null | undefined, atomId: string): RegistryAtomEntry | null;
export declare function findVersionRecord(entry: RegistryAtomEntry | null | undefined, version: string): VersionRecord | null;
export declare function resolveRegistryDiffTarget(registryDoc: RegistryDocument | null | undefined, atomId: string): RegistryDiffResolution;
export declare function computeHashDiffReport(options: HashDiffReportOptions): Record<string, unknown>;
export declare function loadRegistryDocument(registryPath: string | null | undefined): RegistryDocument;
export {};

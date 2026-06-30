import { normalizeSemanticFingerprint, semanticFingerprintPrefix } from './semantic-fingerprint.ts';
export declare class RegistryIndexError extends Error {
    code: string;
    details: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
interface RegistryEntry {
    atomId?: string;
    id?: string;
    mapId?: string;
    mapVersion?: string;
    atomVersion?: string;
    currentVersion?: string;
    logicalName?: string;
    semanticFingerprint?: string | null;
    mapSemanticFingerprint?: string | null;
    versions?: Array<{
        version?: string;
    }>;
    members?: RegistryMember[];
    schemaId?: string;
}
interface RegistryMember {
    atomId?: string;
    version?: string;
    versionLineage?: {
        currentVersion?: string;
        versions?: Array<{
            version?: string;
        }>;
    };
}
interface NodeRef {
    nodeKind: 'atom' | 'map';
    canonicalId: string;
    version: string | null;
    urn: string;
    entry: RegistryEntry;
}
interface DiagnosticRecord {
    code: string;
    severity: string;
    entry: RegistryEntry;
}
interface VersionRecord {
    current: string | null;
    versions: Set<string>;
}
interface CreateRegistryIndexOptions {
    allowDuplicates?: boolean;
    repositoryRoot?: string;
}
interface RegistryDocument {
    entries?: RegistryEntry[];
    registryId?: string;
}
export declare function createRegistryIndex(registryDocument: RegistryDocument | null | undefined, options?: CreateRegistryIndexOptions): Readonly<{
    registryId: string | null;
    size: number;
    diagnostics: DiagnosticRecord[];
    atomIdIndex: Map<string, NodeRef>;
    mapIdIndex: Map<string, NodeRef>;
    logicalNameIndex: Map<string, NodeRef[]>;
    fingerprintIndex: Map<string, NodeRef[]>;
    versionIndex: Map<string, VersionRecord>;
    nodeRefs: NodeRef[];
    getByCanonicalId(canonicalId: string): NodeRef | null;
    getByUrn(urn: string): NodeRef | null;
    findByLogicalName(logicalName: string): NodeRef[];
    findBySemanticFingerprint(fingerprint: string): NodeRef[];
    findByFingerprintPrefix(prefix: string): NodeRef[];
    getVersions(canonicalId: string): {
        current: string | null;
        versions: string[];
    };
    toJSON(): {
        registryId: string | null;
        size: number;
        atomIds: string[];
        mapIds: string[];
        logicalNames: string[];
        fingerprintKeys: string[];
        versionKeys: string[];
        diagnostics: DiagnosticRecord[];
    };
}>;
export declare function createNodeRef(entry: RegistryEntry | null | undefined): NodeRef | null;
export { normalizeSemanticFingerprint, semanticFingerprintPrefix };

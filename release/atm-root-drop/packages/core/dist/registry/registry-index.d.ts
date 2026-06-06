import { normalizeSemanticFingerprint, semanticFingerprintPrefix } from './semantic-fingerprint.ts';
export declare class RegistryIndexError extends Error {
    code: string;
    details: Record<string, unknown>;
    constructor(code: string, message: string, details?: Record<string, unknown>);
}
export declare function createRegistryIndex(registryDocument: any, options?: any): Readonly<{
    registryId: any;
    size: number;
    diagnostics: any[];
    atomIdIndex: Map<any, any>;
    mapIdIndex: Map<any, any>;
    logicalNameIndex: Map<any, any>;
    fingerprintIndex: Map<any, any>;
    versionIndex: Map<any, any>;
    nodeRefs: any[];
    getByCanonicalId(canonicalId: any): any;
    getByUrn(urn: any): any;
    findByLogicalName(logicalName: any): any;
    findBySemanticFingerprint(fingerprint: any): any;
    findByFingerprintPrefix(prefix: any): any;
    getVersions(canonicalId: any): {
        current: any;
        versions: any[];
    };
    toJSON(): {
        registryId: any;
        size: number;
        atomIds: any[];
        mapIds: any[];
        logicalNames: any[];
        fingerprintKeys: any[];
        versionKeys: any[];
        diagnostics: any[];
    };
}>;
export declare function createNodeRef(entry: any): Readonly<{
    nodeKind: string;
    canonicalId: string;
    version: string | null;
    urn: string;
    entry: any;
}> | null;
export { normalizeSemanticFingerprint, semanticFingerprintPrefix };

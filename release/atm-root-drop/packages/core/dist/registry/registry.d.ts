import { type SemanticFingerprintPortRecord } from './semantic-fingerprint.ts';
export declare const defaultRegistrySchemaPath: string;
export declare const defaultRegistryOwner: Readonly<{
    name: "ATM maintainers";
    contact: "maintainers@example.invalid";
}>;
/** Shape expected for a normalized atom spec model passed into registry functions */
interface NormalizedModel {
    identity: {
        atomId: string;
        logicalName?: string;
    };
    schema: {
        schemaId: string;
        specVersion: string;
    };
    source: {
        specPath: string | null;
        schemaPath?: string;
    };
    hashLock: Record<string, unknown>;
    governance?: {
        semanticFingerprint?: unknown;
    };
    ports?: {
        inputs?: SemanticFingerprintPortRecord[];
        outputs?: SemanticFingerprintPortRecord[];
    };
    execution: {
        language?: {
            primary?: string | null;
        };
        validation?: {
            evidenceRequired?: boolean;
        };
        performanceBudget?: Readonly<Record<string, unknown>> | null;
        compatibility: {
            coreVersion: string;
            registryVersion: string;
            pluginApiVersion?: string;
            languageAdapter?: string;
        };
    };
}
/** Options accepted by createAtomicRegistryEntry */
interface RegistryEntryOptions {
    repositoryRoot?: string;
    specPath?: string;
    codePaths?: string | string[];
    testPaths?: string | string[];
    legacyPlanningId?: string | null;
    reportPath?: string | null;
    workbenchPath?: string | null;
    atomVersion?: string | number;
    currentVersion?: string;
    semanticFingerprint?: unknown;
    versions?: VersionRecord[];
    status?: string;
    governance?: {
        tier?: string;
    };
    governanceTier?: string;
    id?: string;
    logicalName?: string;
    schemaPath?: string;
    owner?: {
        name?: string;
        contact?: string;
    };
    lineageLogRef?: string;
    evidenceIndexRef?: string;
    ttl?: number;
    evidence?: string[];
    testReport?: {
        artifacts?: Array<{
            artifactKind: string;
            artifactPath: string;
        }>;
        evidence?: Array<{
            artifactPaths?: string[];
        }>;
    };
}
interface VersionRecord {
    version?: string;
    specHash?: string;
    codeHash?: string;
    testHash?: string;
    timestamp?: string;
    semanticFingerprint?: unknown;
}
interface NormalizedVersionRecord {
    version: string;
    specHash: string;
    codeHash: string;
    testHash: string;
    timestamp: string;
    semanticFingerprint?: unknown;
}
/** Options for createRegistryDocument */
interface RegistryDocumentOptions {
    registryId?: string;
    generatedAt?: string;
    migration?: {
        strategy?: string;
        fromVersion?: string | null;
        notes?: string;
    };
    sharding?: {
        strategy?: string;
        partPaths?: string[];
        nextRegistryId?: string | null;
    };
}
/** Options for writeRegistryArtifacts */
interface WriteRegistryArtifactsOptions {
    repositoryRoot?: string;
    registryPath?: string;
    writeCatalog?: boolean;
    specRepositoryRoot?: string;
    catalogPath?: string;
    catalogTitle?: string;
    sourceOfTruthLabel?: string;
}
/** Options for validateRegistryDocument */
interface ValidateRegistryDocumentOptions {
    schemaPath?: string;
    validatorMode?: string;
    validatorReason?: string;
}
/** Options for evaluateRegistryEntryDrift */
interface EvaluateRegistryEntryDriftOptions {
    repositoryRoot?: string;
}
export declare function createAtomicRegistryEntry(normalizedModel: NormalizedModel, options?: RegistryEntryOptions): {
    id: string;
    atomId: string;
    logicalName: string | undefined;
    atomVersion: string;
    currentVersion: string;
    versions: NormalizedVersionRecord[];
    schemaId: string;
    specVersion: string;
    schemaPath: string | undefined;
    specPath: string;
    hashLock: {
        [x: string]: unknown;
    };
    owner: {
        name: string;
        contact: string;
    };
    status: import("../index.ts").RegistryEntryStatus;
    governance: import("../index.ts").RegistryGovernanceRecord;
    semanticFingerprint: string | null;
    location: {
        specPath: string;
        codePaths: string[];
        testPaths: string[];
        reportPath: string | null;
        workbenchPath: string | null;
    };
    lineageLogRef: string | undefined;
    evidenceIndexRef: string | undefined;
    ttl: number | undefined;
    compatibility: Record<string, string>;
    evidence: string[];
    selfVerification: {
        legacyPlanningId: string | null;
        specHash: string;
        codeHash: string;
        testHash: string;
        sourcePaths: {
            spec: string;
            code: string[];
            tests: string[];
        };
    };
};
export declare function createRegistryDocument(entries: unknown[], options?: RegistryDocumentOptions): Record<string, unknown>;
export declare function writeRegistryArtifacts(registryDocument: Record<string, unknown>, options?: WriteRegistryArtifactsOptions): {
    registryPath: string;
    catalogPath: string | null;
};
export declare function validateRegistryDocument(registryDocument: unknown, options?: ValidateRegistryDocumentOptions): {
    ok: boolean;
    schemaPath: string;
    promptReport: {
        code: string;
        summary: string;
        issues: ValidationIssue[];
    };
};
export declare function validateRegistryDocumentFile(registryPath: string, options?: ValidateRegistryDocumentOptions): {
    registryPath: string;
    document: any;
    ok: boolean;
    schemaPath: string;
    promptReport: {
        code: string;
        summary: string;
        issues: ValidationIssue[];
    };
};
interface RegistryEntry {
    selfVerification?: {
        sourcePaths?: {
            spec?: string;
            code?: string | string[];
            tests?: string[];
        };
        specHash?: string;
        codeHash?: string;
        testHash?: string;
        legacyPlanningId?: string | null;
    };
}
export declare function evaluateRegistryEntryDrift(entry: RegistryEntry, options?: EvaluateRegistryEntryDriftOptions): {
    ok: boolean;
    issues: string[];
    report: null;
    entry: RegistryEntry;
    error: string;
} | {
    ok: boolean;
    issues: string[];
    report: {
        legacyPlanningId: {
            expected: string | null;
            actual: string | null;
            ok: boolean;
        };
        specHash: {
            expected: string | undefined;
            actual: string;
            ok: boolean;
        };
        codeHash: {
            expected: string | undefined;
            actual: string;
            ok: boolean;
        };
        testHash: {
            expected: string | undefined;
            actual: string;
            ok: boolean;
        };
    };
    entry: RegistryEntry;
    error?: undefined;
};
interface ValidationIssue {
    code: string;
    keyword: string;
    path: string;
    text: string;
    prompt: string;
}
export {};

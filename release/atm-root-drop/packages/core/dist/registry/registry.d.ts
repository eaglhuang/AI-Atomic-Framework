export declare const defaultRegistrySchemaPath: string;
export declare const defaultRegistryOwner: Readonly<{
    name: "ATM maintainers";
    contact: "maintainers@example.invalid";
}>;
export declare function createAtomicRegistryEntry(normalizedModel: any, options?: any): {
    id: any;
    atomId: any;
    logicalName: any;
    atomVersion: string;
    currentVersion: string;
    versions: any[];
    schemaId: any;
    specVersion: any;
    schemaPath: any;
    specPath: any;
    hashLock: any;
    owner: {
        name: any;
        contact: any;
    };
    status: import("../index.ts").RegistryEntryStatus;
    governance: import("../index.ts").RegistryGovernanceRecord;
    semanticFingerprint: string | null;
    location: {
        specPath: any;
        codePaths: any[];
        testPaths: any[];
        reportPath: any;
        workbenchPath: any;
    };
    lineageLogRef: any;
    evidenceIndexRef: any;
    ttl: any;
    compatibility: any;
    evidence: unknown[];
    selfVerification: {
        legacyPlanningId: any;
        specHash: string;
        codeHash: string;
        testHash: string;
        sourcePaths: {
            spec: any;
            code: any[];
            tests: any[];
        };
    };
};
export declare function createRegistryDocument(entries: any, options?: any): any;
export declare function writeRegistryArtifacts(registryDocument: any, options?: any): {
    registryPath: any;
    catalogPath: null;
};
export declare function validateRegistryDocument(registryDocument: any, options?: any): {
    ok: boolean;
    schemaPath: any;
    promptReport: {
        code: any;
        summary: string;
        issues: any;
    };
};
export declare function validateRegistryDocumentFile(registryPath: any, options?: any): {
    registryPath: any;
    document: any;
    ok: boolean;
    schemaPath: any;
    promptReport: {
        code: any;
        summary: string;
        issues: any;
    };
};
export declare function evaluateRegistryEntryDrift(entry: any, options?: any): {
    ok: boolean;
    issues: string[];
    report: null;
    entry: any;
    error: string;
} | {
    ok: boolean;
    issues: string[];
    report: {
        legacyPlanningId: {
            expected: any;
            actual: any;
            ok: boolean;
        };
        specHash: {
            expected: any;
            actual: string;
            ok: boolean;
        };
        codeHash: {
            expected: any;
            actual: string;
            ok: boolean;
        };
        testHash: {
            expected: any;
            actual: string;
            ok: boolean;
        };
    };
    entry: any;
    error?: undefined;
};

import type { NormalizedModel, NormalizedVersionRecord, RegistryEntryOptions } from './types.ts';
export declare const defaultRegistryOwner: Readonly<{
    name: "ATM maintainers";
    contact: "maintainers@example.invalid";
}>;
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
    status: import("../../index.ts").RegistryEntryStatus;
    governance: import("../../index.ts").RegistryGovernanceRecord;
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

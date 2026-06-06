export declare function generateAtom(request: any, options?: any): any;
export declare function createMinimalAtomSpec(request: any): {
    schemaId: string;
    specVersion: string;
    migration: {
        strategy: string;
        fromVersion: null;
        notes: string;
    };
    id: any;
    logicalName: string;
    title: any;
    description: any;
    language: {
        primary: string;
        sourceExtensions: string[];
        tooling: string[];
    };
    runtime: {
        kind: string;
        versionRange: string;
        environment: string;
    };
    adapterRequirements: {
        projectAdapter: string;
        storage: string;
        capabilities: string[];
    };
    compatibility: {
        coreVersion: string;
        registryVersion: string;
        languageAdapter: string;
        lifecycleMode: string;
    };
    hashLock: {
        algorithm: string;
        digest: string;
        canonicalization: string;
    };
    dependencyPolicy: {
        external: string;
        hostCoupling: string;
    };
    inputs: {
        name: string;
        kind: string;
        required: boolean;
    }[];
    outputs: {
        name: string;
        kind: string;
        required: boolean;
    }[];
    validation: {
        commands: any[];
        evidenceRequired: boolean;
    };
    performanceBudget: {
        hotPath: boolean;
        inputMutation: string;
        maxDurationMs: number;
    };
    semanticFingerprint: string;
    deployScope: string;
    mutabilityPolicy: string;
    tags: string[];
};

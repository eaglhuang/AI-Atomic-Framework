interface NormalizedRequest {
    bucket: string;
    title: string;
    description: string;
    logicalName: string;
}
interface PhaseRecord {
    phase: string;
    ok: boolean;
    durationMs: number;
    error?: ReturnType<typeof normalizeError>;
}
interface RegistryDocument {
    schemaId?: string;
    specVersion?: string;
    migration?: Record<string, unknown>;
    registryId?: string;
    generatedAt?: string;
    entries?: unknown[];
}
interface RegistryEntry {
    atomId?: string;
    logicalName?: string;
    schemaId?: string;
    specVersion?: string;
    mapVersion?: string;
    evidence?: readonly string[];
    members?: readonly unknown[];
    edges?: readonly unknown[];
    replacement?: unknown;
    location?: {
        workbenchPath?: string;
        specPath?: string;
        codePaths?: string[];
        testPaths?: string[];
        reportPath?: string | null;
    };
    specPath?: string;
    selfVerification?: {
        sourcePaths?: {
            spec?: string;
            code?: readonly string[];
        };
    };
}
interface AtomIdAllocationRecord {
    atomId: string;
    bucket: string;
    sequence: number;
    source: string;
    reservation: string | null;
}
interface GenerateAtomOptions {
    repositoryRoot?: string;
    registryPath?: string;
    dryRun?: boolean;
    force?: boolean;
    atomId?: string | null;
    atomVersion?: string;
    status?: string;
    owner?: {
        name?: string;
        contact?: string;
    };
    codePaths?: string[];
    testPaths?: string[];
    testContent?: string;
    sourceContent?: string;
    validationCommands?: string[];
    logicalName?: string;
    now?: string;
    catalogPath?: string;
    overwriteExisting?: boolean;
    evidence?: string[];
    legacyPlanningId?: string | null;
    registryDocument?: RegistryDocument;
}
interface GenerateAtomResult {
    ok: boolean;
    atomId: string | null;
    workbenchPath?: string | null;
    specPath?: string | null;
    sourcePath?: string | null;
    testPath?: string | null;
    registryEntry?: RegistryEntry | null;
    registryPath?: string | null;
    catalogPath?: string | null;
    allocation?: AtomIdAllocationRecord | null;
    scaffold?: unknown | null;
    testRun?: unknown | null;
    idempotent?: boolean;
    dryRun?: boolean;
    phases: PhaseRecord[];
    failedPhase?: string | null;
    error?: {
        code: string;
        message: string;
        details: Record<string, unknown>;
    };
}
export declare function generateAtom(request: unknown, options?: GenerateAtomOptions): GenerateAtomResult;
interface CreateMinimalAtomSpecRequest extends NormalizedRequest {
    atomId: string;
    sourcePath?: string | null;
    validationCommands?: string[];
}
export declare function createMinimalAtomSpec(request: CreateMinimalAtomSpecRequest): {
    schemaId: string;
    specVersion: string;
    migration: {
        strategy: string;
        fromVersion: null;
        notes: string;
    };
    id: string;
    logicalName: string;
    title: string;
    description: string;
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
        commands: string[];
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
declare function normalizeError(error: unknown): {
    code: string;
    message: string;
    details: Record<string, unknown>;
};
export {};

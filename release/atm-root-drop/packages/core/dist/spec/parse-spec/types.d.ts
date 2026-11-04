export interface ParseAtomicSpecOptions {
    readonly cwd?: string;
    readonly specPath?: string;
    readonly schemaPath?: string;
}
export interface PromptIssue {
    readonly code: string;
    readonly keyword: string;
    readonly path: string;
    readonly text: string;
    readonly prompt: string;
}
export interface FailureOptions {
    readonly code: string;
    readonly specPath: string | null;
    readonly schemaPath: string | null;
    readonly summary: string;
    readonly issues: readonly PromptIssue[];
}
export interface ParsePromptReport {
    readonly code: string;
    readonly summary: string;
    readonly issues: PromptIssue[];
}
export interface ParseAtomicSpecSuccess {
    readonly ok: true;
    readonly specPath: string | null;
    readonly schemaPath: string;
    readonly normalizedModel: NormalizedAtomicSpecModel;
    readonly promptReport: ParsePromptReport;
}
export interface ParseAtomicSpecFailure {
    readonly ok: false;
    readonly specPath: string | null;
    readonly schemaPath: string | null;
    readonly normalizedModel: null;
    readonly promptReport: ParsePromptReport;
}
export interface JsonReadSuccess {
    readonly ok: true;
    readonly document: unknown;
}
export interface JsonReadFailure {
    readonly ok: false;
    readonly issue: PromptIssue;
}
export interface AtomicSpecPortRecord {
    readonly name: string;
    readonly kind: string;
    readonly required: boolean;
}
export interface AtomicSpecDocument {
    readonly id: string;
    readonly schemaId: string;
    readonly specVersion: string;
    readonly title: string;
    readonly description?: string;
    readonly logicalName?: string | null;
    readonly tags?: readonly string[];
    readonly migration: {
        readonly strategy: string;
        readonly fromVersion?: string | null;
        readonly notes: string;
    };
    readonly language: {
        readonly primary: string;
        readonly sourceExtensions?: readonly string[];
        readonly tooling?: readonly string[];
    };
    readonly runtime: {
        readonly kind: string;
        readonly versionRange: string;
        readonly environment: string;
    };
    readonly adapterRequirements: {
        readonly projectAdapter: string;
        readonly storage: string;
        readonly capabilities?: readonly string[];
    };
    readonly compatibility: {
        readonly coreVersion: string;
        readonly registryVersion: string;
        readonly pluginApiVersion?: string | null;
        readonly languageAdapter?: string | null;
        readonly lifecycleMode?: string | null;
    };
    readonly dependencyPolicy?: {
        readonly external?: string;
        readonly hostCoupling?: string;
    };
    readonly validation?: {
        readonly commands?: readonly string[];
        readonly evidenceRequired?: boolean;
    };
    readonly performanceBudget?: {
        readonly hotPath?: boolean;
        readonly inputMutation?: string;
        readonly maxDurationMs?: number;
    };
    readonly semanticFingerprint?: unknown;
    readonly lineage?: {
        readonly bornBy?: string;
        readonly parentRefs?: readonly string[];
        readonly bornAt?: string;
    } | null;
    readonly ttl?: {
        readonly expiresAt?: string;
    } | null;
    readonly deployScope?: string;
    readonly mutabilityPolicy?: string;
    readonly pendingSfCalculation?: boolean;
    readonly hashLock: {
        readonly algorithm: string;
        readonly digest: string;
        readonly canonicalization: string;
    };
    readonly inputs?: readonly AtomicSpecPortRecord[];
    readonly outputs?: readonly AtomicSpecPortRecord[];
}
export interface NormalizedAtomicSpecModel {
    readonly source: {
        readonly specPath: string | null;
        readonly schemaPath: string;
    };
    readonly schema: {
        readonly schemaId: string;
        readonly specVersion: string;
        readonly migration: {
            readonly strategy: string;
            readonly fromVersion: string | null;
            readonly notes: string;
        };
    };
    readonly identity: {
        readonly atomId: string;
        readonly logicalName?: string;
        readonly title: string;
        readonly description: string;
        readonly tags: string[];
    };
    readonly execution: {
        readonly language: {
            readonly primary: string;
            readonly sourceExtensions: string[];
            readonly tooling: string[];
        };
        readonly runtime: {
            readonly kind: string;
            readonly versionRange: string;
            readonly environment: string;
        };
        readonly adapterRequirements: {
            readonly projectAdapter: string;
            readonly storage: string;
            readonly capabilities: string[];
        };
        readonly compatibility: {
            readonly coreVersion: string;
            readonly registryVersion: string;
            readonly pluginApiVersion: string;
            readonly languageAdapter: string;
            readonly lifecycleMode: string;
        };
        readonly dependencyPolicy: {
            readonly external: string;
            readonly hostCoupling: string;
        };
        readonly validation: {
            readonly commands: string[];
            readonly evidenceRequired: boolean;
        };
        readonly performanceBudget: {
            readonly hotPath: boolean;
            readonly inputMutation: string;
            readonly maxDurationMs: number | null;
        };
    };
    readonly governance: {
        readonly semanticFingerprint: unknown;
        readonly lineage: {
            readonly bornBy?: string;
            readonly parentRefs: string[];
            readonly bornAt?: string;
        } | null;
        readonly ttl: {
            readonly expiresAt: string | null;
        } | null;
        readonly deployScope: string | null;
        readonly mutabilityPolicy: string | null;
        readonly pendingSfCalculation: boolean;
    };
    readonly hashLock: {
        readonly algorithm: string;
        readonly digest: string;
        readonly canonicalization: string;
    };
    readonly ports: {
        readonly inputs: AtomicSpecPortRecord[];
        readonly outputs: AtomicSpecPortRecord[];
    };
}

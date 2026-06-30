import { defaultAtomSpecFileName, defaultAtomTestFileName, defaultAtomWorkbenchRoot, resolveAtomWorkbenchPath } from './atom-space.ts';
export declare const defaultAtomSpecTemplatePath: string;
export declare const defaultAtomTestTemplatePath: string;
export { defaultAtomWorkbenchRoot, defaultAtomSpecFileName, defaultAtomTestFileName, resolveAtomWorkbenchPath };
interface ScaffoldModel {
    source?: {
        specPath?: string | null;
        schemaPath?: string;
    };
    identity: {
        atomId: string;
        title: string;
        description: string;
        tags: unknown[];
    };
    schema: {
        schemaId: string;
        specVersion: string;
        migration: {
            strategy: string;
            fromVersion: string | null;
            notes: string;
        };
    };
    execution: {
        language: {
            primary: string;
            sourceExtensions: unknown[];
            tooling: unknown[];
        };
        runtime: {
            kind: string;
            versionRange: string;
            environment: string;
        };
        adapterRequirements: {
            projectAdapter: string;
            storage: string;
            capabilities: unknown[];
        };
        compatibility: {
            coreVersion: string;
            registryVersion: string;
            pluginApiVersion: string;
            languageAdapter: string;
            lifecycleMode?: string;
        };
        dependencyPolicy: {
            external: string;
            hostCoupling: string;
        };
        validation: {
            commands: unknown[];
            evidenceRequired: boolean;
        };
        performanceBudget: {
            hotPath: boolean;
            inputMutation: string;
            maxDurationMs: number | null;
        };
    };
    hashLock: {
        algorithm: string;
        digest: string;
        canonicalization: string;
    };
    ports: {
        inputs: unknown[];
        outputs: unknown[];
    };
}
interface ScaffoldOptions {
    repositoryRoot?: string;
    workbenchPath?: string;
    workbenchRoot?: string;
    specFileName?: string;
    testFileName?: string;
    specTemplatePath?: string;
    testTemplatePath?: string;
    dryRun?: boolean;
    overwriteExisting?: boolean;
}
export declare function scaffoldAtomWorkbench(normalizedModel: ScaffoldModel | null, options?: ScaffoldOptions): {
    ok: boolean;
    atomId: string;
    workbenchPath: string;
    dryRun: boolean;
    overwrittenExisting: boolean;
    createdFiles: Array<{
        kind: string;
        outputPath: string;
    }>;
    overwrittenFiles: Array<{
        kind: string;
        outputPath: string;
    }>;
    skippedFiles: Array<{
        kind: string;
        outputPath: string;
        reason: string;
    }>;
    renderedFiles: Array<{
        kind: string;
        outputPath: string;
        templatePath: string;
    }>;
};

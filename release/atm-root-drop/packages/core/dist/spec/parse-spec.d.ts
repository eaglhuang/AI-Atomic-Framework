export declare const defaultAtomicSpecSchemaPath: string;
export declare function parseAtomicSpecFile(specOption: any, options?: any): {
    ok: boolean;
    specPath: any;
    schemaPath: any;
    normalizedModel: null;
    promptReport: {
        code: any;
        summary: any;
        issues: any;
    };
} | {
    ok: boolean;
    specPath: any;
    schemaPath: any;
    normalizedModel: {
        source: {
            specPath: any;
            schemaPath: any;
        };
        schema: {
            schemaId: any;
            specVersion: any;
            migration: {
                strategy: any;
                fromVersion: any;
                notes: any;
            };
        };
        identity: {
            atomId: any;
            logicalName: any;
            title: any;
            description: any;
            tags: unknown[];
        };
        execution: {
            language: {
                primary: any;
                sourceExtensions: unknown[];
                tooling: unknown[];
            };
            runtime: {
                kind: any;
                versionRange: any;
                environment: any;
            };
            adapterRequirements: {
                projectAdapter: any;
                storage: any;
                capabilities: unknown[];
            };
            compatibility: {
                coreVersion: any;
                registryVersion: any;
                pluginApiVersion: any;
                languageAdapter: any;
                lifecycleMode: any;
            };
            dependencyPolicy: {
                external: any;
                hostCoupling: any;
            };
            validation: {
                commands: any[];
                evidenceRequired: boolean;
            };
            performanceBudget: {
                hotPath: boolean;
                inputMutation: any;
                maxDurationMs: any;
            };
        };
        governance: {
            semanticFingerprint: string | null;
            lineage: {
                bornBy: string | null;
                parentRefs: unknown[];
                bornAt: string | null;
            } | null;
            ttl: {
                expiresAt: string | null;
            } | null;
            deployScope: string | null;
            mutabilityPolicy: string | null;
            pendingSfCalculation: boolean;
        };
        hashLock: {
            algorithm: any;
            digest: any;
            canonicalization: any;
        };
        ports: {
            inputs: any;
            outputs: any;
        };
    };
    promptReport: {
        code: string;
        summary: string;
        issues: never[];
    };
};
export declare function parseAtomicSpecDocument(specDocument: any, options?: any): {
    ok: boolean;
    specPath: any;
    schemaPath: any;
    normalizedModel: null;
    promptReport: {
        code: any;
        summary: any;
        issues: any;
    };
} | {
    ok: boolean;
    specPath: any;
    schemaPath: any;
    normalizedModel: {
        source: {
            specPath: any;
            schemaPath: any;
        };
        schema: {
            schemaId: any;
            specVersion: any;
            migration: {
                strategy: any;
                fromVersion: any;
                notes: any;
            };
        };
        identity: {
            atomId: any;
            logicalName: any;
            title: any;
            description: any;
            tags: unknown[];
        };
        execution: {
            language: {
                primary: any;
                sourceExtensions: unknown[];
                tooling: unknown[];
            };
            runtime: {
                kind: any;
                versionRange: any;
                environment: any;
            };
            adapterRequirements: {
                projectAdapter: any;
                storage: any;
                capabilities: unknown[];
            };
            compatibility: {
                coreVersion: any;
                registryVersion: any;
                pluginApiVersion: any;
                languageAdapter: any;
                lifecycleMode: any;
            };
            dependencyPolicy: {
                external: any;
                hostCoupling: any;
            };
            validation: {
                commands: any[];
                evidenceRequired: boolean;
            };
            performanceBudget: {
                hotPath: boolean;
                inputMutation: any;
                maxDurationMs: any;
            };
        };
        governance: {
            semanticFingerprint: string | null;
            lineage: {
                bornBy: string | null;
                parentRefs: unknown[];
                bornAt: string | null;
            } | null;
            ttl: {
                expiresAt: string | null;
            } | null;
            deployScope: string | null;
            mutabilityPolicy: string | null;
            pendingSfCalculation: boolean;
        };
        hashLock: {
            algorithm: any;
            digest: any;
            canonicalization: any;
        };
        ports: {
            inputs: any;
            outputs: any;
        };
    };
    promptReport: {
        code: string;
        summary: string;
        issues: never[];
    };
};
export declare function normalizeAtomicSpecModel(specDocument: any, options?: any): {
    source: {
        specPath: any;
        schemaPath: any;
    };
    schema: {
        schemaId: any;
        specVersion: any;
        migration: {
            strategy: any;
            fromVersion: any;
            notes: any;
        };
    };
    identity: {
        atomId: any;
        logicalName: any;
        title: any;
        description: any;
        tags: unknown[];
    };
    execution: {
        language: {
            primary: any;
            sourceExtensions: unknown[];
            tooling: unknown[];
        };
        runtime: {
            kind: any;
            versionRange: any;
            environment: any;
        };
        adapterRequirements: {
            projectAdapter: any;
            storage: any;
            capabilities: unknown[];
        };
        compatibility: {
            coreVersion: any;
            registryVersion: any;
            pluginApiVersion: any;
            languageAdapter: any;
            lifecycleMode: any;
        };
        dependencyPolicy: {
            external: any;
            hostCoupling: any;
        };
        validation: {
            commands: any[];
            evidenceRequired: boolean;
        };
        performanceBudget: {
            hotPath: boolean;
            inputMutation: any;
            maxDurationMs: any;
        };
    };
    governance: {
        semanticFingerprint: string | null;
        lineage: {
            bornBy: string | null;
            parentRefs: unknown[];
            bornAt: string | null;
        } | null;
        ttl: {
            expiresAt: string | null;
        } | null;
        deployScope: string | null;
        mutabilityPolicy: string | null;
        pendingSfCalculation: boolean;
    };
    hashLock: {
        algorithm: any;
        digest: any;
        canonicalization: any;
    };
    ports: {
        inputs: any;
        outputs: any;
    };
};

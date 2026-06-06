export declare const frameworkRepoRoot: string;
export declare const registrySchemaPath: string;
export declare const registryFilePath: string;
export declare const seedRegistryEvidencePath = "scripts/validate-seed-registry.ts";
export declare const seedRegistryId = "registry.seed";
export declare const seedGovernedByLegacyPlanningId = "ATM-CORE-0002";
export declare function computeSeedRegistrySnapshot(): {
    generatedAt: string;
    entry: {
        atomId: any;
        schemaId: any;
        specVersion: any;
        schemaPath: string;
        specPath: string;
        hashLock: any;
        owner: {
            name: string;
            contact: string;
        };
        status: string;
        governance: {
            tier: string;
        };
        compatibility: {
            coreVersion: any;
            registryVersion: any;
        };
        evidence: string[];
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
};
export declare function createSeedRegistryDocument(): any;
export declare function readRegistryDocument(): any;
export declare function validateRegistryDocumentAgainstSchema(cwd: any, registryPath?: string, options?: {
    commandName?: string;
    successCode?: string;
    successText?: string;
}): import("./shared.ts").CommandResult;
export declare function evaluateSeedSelfVerification(registry?: any): {
    ok: boolean;
    issues: string[];
    report: null;
    entry?: undefined;
} | {
    ok: boolean;
    issues: string[];
    report: {
        legacyPlanningId: {
            expected: string;
            actual: any;
            ok: boolean;
        };
        specHash: {
            expected: string | null;
            actual: any;
            ok: boolean;
        };
        codeHash: {
            expected: string | null;
            actual: any;
            ok: boolean;
        };
        testHash: {
            expected: string | null;
            actual: any;
            ok: boolean;
        };
    };
    entry: any;
};
export declare function evaluateSeedGovernance(registry?: any): {
    ok: boolean;
    frameworkPhase: string;
    atomId: any;
    atomStatus: any;
    governanceTier: any;
    legacyPlanningId: any;
    governedByLegacyPlanningId: string;
    selfVerificationOk: boolean;
    verificationIssues: string[];
};

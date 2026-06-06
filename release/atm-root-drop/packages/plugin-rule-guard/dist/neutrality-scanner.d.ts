export declare const defaultNeutralityPolicyRelativePath = "docs/governance/docs-neutrality-policy.json";
export declare function loadNeutralityPolicy(options?: any): any;
export declare function scanNeutralityRepository(options?: any): {
    schemaId: string;
    specVersion: string;
    migration: {
        strategy: string;
        fromVersion: null;
        notes: string;
    };
    atomId: string;
    legacyPlanningId: string;
    repositoryRoot: string;
    policyPath: any;
    ok: boolean;
    exitCode: number;
    totals: {
        scannedFiles: number;
        termViolations: number;
        pathViolations: number;
        violations: number;
    };
    scope: {
        protectedFiles: any[];
        protectedScopes: any;
    };
    violations: any[];
};
export declare function formatGitHubAnnotations(report: any): any;
export declare function scanNeutralityText(input: any, options?: any): {
    ok: boolean;
    relativePath: string;
    violations: any[];
    bannedTerms: any[];
};

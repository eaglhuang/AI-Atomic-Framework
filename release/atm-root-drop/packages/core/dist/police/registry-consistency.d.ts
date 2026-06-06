export declare function evaluatePromotionGate(options?: any): {
    lifecycleMode: any;
    canPromote: boolean;
    reports: {
        nonRegression: {
            required: boolean;
            passed: boolean;
            reportId?: undefined;
        } | {
            required: boolean;
            passed: boolean;
            reportId: any;
        };
        qualityComparison: {
            required: boolean;
            passed: boolean;
            reportId?: undefined;
        } | {
            required: boolean;
            passed: boolean;
            reportId: any;
        };
        registryCandidate: {
            required: boolean;
            passed: boolean;
            reportId?: undefined;
        } | {
            required: boolean;
            passed: boolean;
            reportId: any;
        };
    };
    failed: string[];
};
export declare function validateRegistryConsistency(options?: any): {
    checkId: any;
    kind: string;
    required: boolean;
    description: any;
    ok: boolean;
    canPromote: boolean;
    violations: {
        code: string;
        severity: string;
        message: string;
    }[];
    gate: {
        lifecycleMode: any;
        canPromote: boolean;
        reports: {
            nonRegression: {
                required: boolean;
                passed: boolean;
                reportId?: undefined;
            } | {
                required: boolean;
                passed: boolean;
                reportId: any;
            };
            qualityComparison: {
                required: boolean;
                passed: boolean;
                reportId?: undefined;
            } | {
                required: boolean;
                passed: boolean;
                reportId: any;
            };
            registryCandidate: {
                required: boolean;
                passed: boolean;
                reportId?: undefined;
            } | {
                required: boolean;
                passed: boolean;
                reportId: any;
            };
        };
        failed: string[];
    };
};

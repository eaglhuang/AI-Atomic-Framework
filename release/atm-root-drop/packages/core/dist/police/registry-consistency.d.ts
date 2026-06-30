interface PromotionGateOptions {
    readonly lifecycleMode?: string;
    readonly nonRegression?: unknown;
    readonly qualityComparison?: unknown;
    readonly registryCandidate?: unknown;
    readonly checkId?: string;
    readonly description?: string;
}
export declare function evaluatePromotionGate(options?: PromotionGateOptions): {
    lifecycleMode: string;
    canPromote: boolean;
    reports: {
        nonRegression: {
            required: boolean;
            passed: boolean;
            reportId?: undefined;
        } | {
            required: boolean;
            passed: boolean;
            reportId: string | null;
        };
        qualityComparison: {
            required: boolean;
            passed: boolean;
            reportId?: undefined;
        } | {
            required: boolean;
            passed: boolean;
            reportId: string | null;
        };
        registryCandidate: {
            required: boolean;
            passed: boolean;
            reportId?: undefined;
        } | {
            required: boolean;
            passed: boolean;
            reportId: string | null;
        };
    };
    failed: string[];
};
export declare function validateRegistryConsistency(options?: PromotionGateOptions): {
    checkId: string;
    kind: string;
    required: boolean;
    description: string;
    ok: boolean;
    canPromote: boolean;
    violations: {
        code: string;
        severity: string;
        message: string;
    }[];
    gate: {
        lifecycleMode: string;
        canPromote: boolean;
        reports: {
            nonRegression: {
                required: boolean;
                passed: boolean;
                reportId?: undefined;
            } | {
                required: boolean;
                passed: boolean;
                reportId: string | null;
            };
            qualityComparison: {
                required: boolean;
                passed: boolean;
                reportId?: undefined;
            } | {
                required: boolean;
                passed: boolean;
                reportId: string | null;
            };
            registryCandidate: {
                required: boolean;
                passed: boolean;
                reportId?: undefined;
            } | {
                required: boolean;
                passed: boolean;
                reportId: string | null;
            };
        };
        failed: string[];
    };
};
export {};

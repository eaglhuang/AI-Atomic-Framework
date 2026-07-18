import type { EvaluateRegistryEntryDriftOptions, RegistryEntry } from './types.ts';
export declare function evaluateRegistryEntryDrift(entry: RegistryEntry, options?: EvaluateRegistryEntryDriftOptions): {
    ok: boolean;
    issues: string[];
    report: null;
    entry: RegistryEntry;
    error: string;
} | {
    ok: boolean;
    issues: string[];
    report: {
        legacyPlanningId: {
            expected: string | null;
            actual: string | null;
            ok: boolean;
        };
        specHash: {
            expected: string | undefined;
            actual: string;
            ok: boolean;
        };
        codeHash: {
            expected: string | undefined;
            actual: string;
            ok: boolean;
        };
        testHash: {
            expected: string | undefined;
            actual: string;
            ok: boolean;
        };
    };
    entry: RegistryEntry;
    error?: undefined;
};

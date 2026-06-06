export declare function parseCanaryPercent(value: string): number;
export declare function resolveCanarySelection(percent: number | null, willModify: readonly string[]): {
    enabled: boolean;
    percent: null;
    selectedFiles: string[];
    deferredFiles: never[];
} | {
    enabled: boolean;
    percent: number;
    selectedFiles: string[];
    deferredFiles: string[];
};
export declare function shouldApplyUpgradeFile(canary: ReturnType<typeof resolveCanarySelection>, filePath: string): boolean;

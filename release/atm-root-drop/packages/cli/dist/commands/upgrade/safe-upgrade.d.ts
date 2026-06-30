interface SafeUpgradeOptions {
    action: 'plan' | 'apply' | 'rollback';
    cwd: string;
    out: string | null;
    fromPlan: string | null;
    backup: string | null;
    canaryPercent: number | null;
    allowUnknownChart: boolean;
}
export declare function firstSafeUpgradeAction(argv: readonly string[]): "apply" | "rollback" | "plan" | null;
export declare function parseSafeUpgradeOptions(argv: readonly string[], action: 'plan' | 'apply' | 'rollback'): {
    cwd: string;
    action: "plan" | "apply" | "rollback";
    out: string | null;
    fromPlan: string | null;
    backup: string | null;
    canaryPercent: number | null;
    allowUnknownChart: boolean;
};
export declare function runSafeUpgradePlan(options: SafeUpgradeOptions): import("../shared.ts").CommandResult;
export declare function runSafeUpgradeApply(options: SafeUpgradeOptions): Promise<import("../shared.ts").CommandResult>;
export declare function runSafeUpgradeRollback(options: SafeUpgradeOptions): import("../shared.ts").CommandResult;
export declare function collectSafeUpgradeFiles(cwd: string): Record<string, unknown>[];
export {};

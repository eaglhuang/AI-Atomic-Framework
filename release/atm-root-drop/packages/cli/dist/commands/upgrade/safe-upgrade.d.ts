export declare function firstSafeUpgradeAction(argv: readonly string[]): "apply" | "rollback" | "plan" | null;
export declare function parseSafeUpgradeOptions(argv: readonly string[], action: 'plan' | 'apply' | 'rollback'): any;
export declare function runSafeUpgradePlan(options: any): import("../shared.ts").CommandResult;
export declare function runSafeUpgradeApply(options: any): Promise<import("../shared.ts").CommandResult>;
export declare function runSafeUpgradeRollback(options: any): import("../shared.ts").CommandResult;
export declare function collectSafeUpgradeFiles(cwd: string): any[];

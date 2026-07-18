import type { ParsedUpgradeCommandOptions } from './types.ts';
export declare function isGuidedLegacyDryRun(options: ParsedUpgradeCommandOptions): boolean;
export declare function runGuidedLegacyDryRunProposal(options: ParsedUpgradeCommandOptions): import("../../shared.ts").CommandResult;
export declare function sanitizeUpgradeBudgetId(value: string | null | undefined): string;

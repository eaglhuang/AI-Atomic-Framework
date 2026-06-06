import type { CommandResult } from './shared.ts';
export declare function resolveSummaryFields(): string[];
export declare function projectFields(result: CommandResult, fields: string[]): CommandResult;
export declare function projectSummary(result: CommandResult): CommandResult;

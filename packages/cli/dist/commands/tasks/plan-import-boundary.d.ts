import { type ParsedPlanResult } from './legacy/implementation.ts';
export declare function parsePlanMarkdown(input: {
    readonly planText: string;
    readonly planRelativePath: string;
    readonly importedAt: string;
}): ParsedPlanResult;

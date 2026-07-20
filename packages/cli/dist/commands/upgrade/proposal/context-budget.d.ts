import type { ParsedUpgradeCommandOptions } from './types.ts';
export declare function evaluateUpgradeContextBudget(options: ParsedUpgradeCommandOptions, inputDocuments: Array<{
    path: string;
    document: Record<string, unknown>;
}>): Promise<{
    gate: null;
    decision: string;
    estimatedTokens: number;
    reportPath: null;
    summaryPath: null;
    continuationReportPath: null;
    contextSummaryPath: null;
    contextSummaryMarkdownPath: null;
    evidencePath: null;
} | {
    gate: {
        passed: boolean;
        reportId: string;
        reportPath: string;
        summary: string;
    };
    decision: "pass" | "summarize-before-continue" | "hard-stop";
    estimatedTokens: number;
    reportPath: string;
    summaryPath: string | null;
    continuationReportPath: string | null;
    contextSummaryPath: string | null;
    contextSummaryMarkdownPath: string | null;
    evidencePath: string | null;
}>;

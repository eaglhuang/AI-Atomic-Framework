export declare function parseUpgradeOptions(argv: any): any;
export declare function isGuidedLegacyDryRun(options: any): boolean;
export declare function runGuidedLegacyDryRunProposal(options: any): import("../shared.ts").CommandResult;
export declare function loadExplicitInputDocuments(cwd: any, inputPaths: any): any;
export declare function discoverInputDocuments(cwd: any): {
    path: string;
    document: any;
}[];
export declare function evaluateUpgradeContextBudget(options: any, inputDocuments: any): Promise<{
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
        reportPath: any;
        summary: string;
    };
    decision: any;
    estimatedTokens: number;
    reportPath: any;
    summaryPath: any;
    continuationReportPath: string | null;
    contextSummaryPath: string | null;
    contextSummaryMarkdownPath: string | null;
    evidencePath: string | null;
}>;

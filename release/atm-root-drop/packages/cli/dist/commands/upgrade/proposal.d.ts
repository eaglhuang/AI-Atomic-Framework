interface UpgradeCommandOptions {
    cwd: string;
    propose: boolean;
    scan: boolean;
    dryRun: boolean;
    atomId: string | null;
    fromVersion: string | null;
    toVersion: string | null;
    behaviorId: string;
    decompositionDecision: string | null;
    inputPaths: string[];
    target: {
        kind: 'atom' | 'map';
        mapId?: string;
    };
    fork: {
        sourceAtomId?: string;
        newAtomId?: string;
    } | null;
    mapImpactScope: {
        affectedMapIds?: string[];
        propagationStatus?: unknown[];
    } | null;
    legacyTarget: string | null;
    guidanceSession: string | null;
    requestedReplacementMode: string | null;
    equivalenceReport: string | null;
    polymorphImpactReport: string | null;
    propagationReport: string | null;
    reviewAdvisory: string | null;
    humanReview: string | null;
    rollbackProof: string | null;
    retirementProof: string | null;
    proposalId: string | null;
    proposedBy: string;
    proposedAt: string | null;
    migration: Record<string, unknown> | null;
}
export type ParsedUpgradeCommandOptions = Omit<UpgradeCommandOptions, 'proposedAt'> & {
    proposedAt: string;
};
export declare function parseUpgradeOptions(argv: readonly string[]): ParsedUpgradeCommandOptions;
export declare function isGuidedLegacyDryRun(options: ParsedUpgradeCommandOptions): boolean;
export declare function runGuidedLegacyDryRunProposal(options: ParsedUpgradeCommandOptions): import("../shared.ts").CommandResult;
export declare function loadExplicitInputDocuments(cwd: string, inputPaths: string[]): {
    path: string;
    document: Record<string, unknown>;
}[];
export declare function discoverInputDocuments(cwd: string): {
    path: string;
    document: Record<string, unknown> & {
        schemaId: string;
    };
}[];
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
export declare function inferInputKind(schemaId: string | null | undefined): "quality-comparison" | "rollback-proof" | "map-equivalence" | "hash-diff" | "execution-evidence" | "non-regression" | "registry-candidate" | "polymorph-impact" | "evidence-pattern-report" | null;
export {};

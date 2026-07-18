import type { DefaultGuardsDocument } from '../../../../plugin-governance-local/src/default-guards.ts';
import type { ATMChartFrontmatter, ATMChartSourceSnapshot, ATMChartSummary } from './types.ts';
export declare function renderATMChart(cwd: string, atmChartAbsolutePath: string): import("../shared.ts").CommandResult;
export declare function verifyATMChart(cwd: string, atmChartAbsolutePath: string, options?: {
    readonly versionCheck?: boolean;
}): import("../shared.ts").CommandResult;
export declare function collectATMChartSources(cwd: string): ATMChartSourceSnapshot;
export declare function createATMChartMarkdown(input: {
    readonly sourceGuardsPath: string;
    readonly sourceGuardsSha256: string;
    readonly sourceSchemaSha256s: Record<string, string>;
    readonly guardDocument: DefaultGuardsDocument;
    readonly atmChartVersion: string;
    readonly frameworkVersion: string;
    readonly templateVersion: string;
    readonly minFrameworkVersion: string;
}): string;
export declare function readDefaultGuards(filePath: string): DefaultGuardsDocument;
export declare function readATMChartFrontmatter(filePath: string): ATMChartFrontmatter;
export declare function parseFrontmatterValue(rawValue: string): any;
export declare function collectSchemaDrift(recorded: Record<string, string>, current: Record<string, string>): ({
    schemaId: string;
    recorded: string;
    current: string;
} | {
    schemaId: string;
    recorded: string;
    current: null;
})[];
export declare function resolveATMChartPath(cwd: string, outOption: unknown): string;
export declare function normalizePath(filePath: string): string;
export declare function loadATMChartSummary(cwd: string, outOption?: unknown): ATMChartSummary;
export declare function extractGuardSummary(body: string): string[];

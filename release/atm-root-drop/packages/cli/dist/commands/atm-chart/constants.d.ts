import type { CompatibilityMatrixDocument, LegacyCompatibilityMatrixDocument } from './types.ts';
export declare const frameworkRoot: string;
export declare const defaultATMChartRelativePath: string;
export declare const atmChartFrontmatterSchemaVersion: "atm.atmChart.v0.1";
export declare const atmChartSourceSchemas: Readonly<{
    'governance/default-guards': "schemas/governance/default-guards.schema.json";
    'charter/charter-invariants': "schemas/charter/charter-invariants.schema.json";
    'integrations/install-manifest': "schemas/integrations/install-manifest.schema.json";
    'agent-prompt': "schemas/agent-prompt.schema.json";
    'upgrade/upgrade-proposal': "schemas/upgrade/upgrade-proposal.schema.json";
}>;
export declare const fallbackCompatibilityMatrix: Readonly<CompatibilityMatrixDocument>;
export declare const fallbackLegacyCompatibilityMatrix: Readonly<LegacyCompatibilityMatrixDocument>;
export declare const versionCacheRelativePath: string;

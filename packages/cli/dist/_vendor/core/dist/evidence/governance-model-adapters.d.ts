export declare const GOVERNANCE_MODEL_ADAPTERS_SCHEMA_ID: "atm.governanceModelAdaptersResult.v1";
export type GovernanceModelKind = 'task' | 'lane' | 'broker' | 'close' | 'runner';
export interface GovernanceAuthority {
    readonly authorityId: string;
    readonly sealed: boolean;
    readonly digest: string;
    readonly version?: string | null;
}
export interface GovernanceModel {
    readonly modelId: string;
    readonly kind: GovernanceModelKind | string;
    readonly state: string;
    readonly owner?: string | null;
    readonly attributes?: Readonly<Record<string, string | number | boolean | null>>;
}
export interface GovernanceAdapterInput {
    readonly runId: string;
    readonly authority: GovernanceAuthority;
    readonly models: readonly GovernanceModel[];
}
export interface GovernanceAdapterDiagnostic {
    readonly code: string;
    readonly severity: 'error' | 'warning';
    readonly message: string;
    readonly ref: string | null;
    readonly repairCommand: string | null;
}
export interface GovernanceAdapterProjection {
    readonly projectionId: string;
    readonly modelId: string;
    readonly kind: GovernanceModelKind;
    readonly canonicalState: string;
    readonly owner: string | null;
    readonly attributes: Readonly<Record<string, string | number | boolean | null>>;
}
export interface GovernanceAdapterResult {
    readonly schemaId: typeof GOVERNANCE_MODEL_ADAPTERS_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly runId: string;
    readonly resultId: string;
    readonly authority: GovernanceAuthority;
    readonly status: 'adapted' | 'blocked' | 'stale' | 'unsupported';
    readonly projections: readonly GovernanceAdapterProjection[];
    readonly diagnostics: readonly GovernanceAdapterDiagnostic[];
    readonly provenance: {
        readonly inputDigest: string;
        readonly modelCount: number;
        readonly adapterKinds: readonly GovernanceModelKind[];
    };
}
/** One authority-preserving adapter seam for task/lane/broker/close/runner models. */
export declare function adaptGovernanceModels(input: GovernanceAdapterInput): GovernanceAdapterResult;
export declare const createGovernanceModelAdapters: typeof adaptGovernanceModels;
export declare function replayGovernanceModelAdapters(input: GovernanceAdapterInput, expected: GovernanceAdapterResult): {
    readonly deterministic: boolean;
    readonly result: GovernanceAdapterResult;
};
export declare function validateGovernanceModelAdapters(result: GovernanceAdapterResult): {
    readonly ok: boolean;
    readonly diagnostics: readonly GovernanceAdapterDiagnostic[];
};

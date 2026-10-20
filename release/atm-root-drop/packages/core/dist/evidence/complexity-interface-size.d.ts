export declare const COMPLEXITY_INTERFACE_SIZE_SCHEMA_ID: "atm.complexityInterfaceSize.v1";
export type ComplexityStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export interface ComplexityAuthority {
    readonly authorityId: string;
    readonly digest: string;
    readonly sealed: true;
}
export interface ComplexityModule {
    readonly moduleId: string;
    readonly cyclomatic: number;
    readonly crap: number;
    readonly interfaceSize: number;
    readonly digest: string;
}
export interface ComplexityInput {
    readonly runId: string;
    readonly generatedAt: string;
    readonly authority: ComplexityAuthority;
    readonly observedAuthorityDigest: string;
    readonly modules: readonly ComplexityModule[];
    readonly maxCyclomatic: number;
    readonly maxCrap: number;
    readonly maxInterfaceSize: number;
}
export interface ComplexityResult {
    readonly schemaId: typeof COMPLEXITY_INTERFACE_SIZE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly runId: string;
    readonly generatedAt: string;
    readonly authority: ComplexityAuthority;
    readonly limits: {
        readonly maxCyclomatic: number;
        readonly maxCrap: number;
        readonly maxInterfaceSize: number;
    };
    readonly modules: readonly ComplexityModule[];
    readonly projection: {
        readonly moduleCount: number;
        readonly violations: readonly string[];
    };
    readonly status: ComplexityStatus;
    readonly diagnostics: readonly string[];
    readonly resultDigest: string;
}
export declare function compileComplexityInterfaceSize(input: ComplexityInput): ComplexityResult;
export declare const createComplexityInterfaceSize: typeof compileComplexityInterfaceSize;
export declare function replayComplexityInterfaceSize(r: ComplexityResult): ComplexityResult;
export declare function validateComplexityInterfaceSize(r: ComplexityResult): {
    ok: boolean;
    diagnostics: string[];
};

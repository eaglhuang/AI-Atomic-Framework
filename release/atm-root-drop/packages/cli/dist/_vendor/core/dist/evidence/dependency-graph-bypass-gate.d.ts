export declare const DEPENDENCY_GRAPH_BYPASS_GATE_SCHEMA_ID: "atm.dependencyGraphBypassGate.v1";
export type DependencyGateStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export type DependencyEdge = readonly [from: string, to: string];
export interface DependencyGateAuthority {
    readonly authorityId: string;
    readonly digest: string;
    readonly sealed: true;
}
export interface DependencyGateInput {
    readonly runId: string;
    readonly authority: DependencyGateAuthority;
    readonly observedAuthorityDigest: string;
    readonly nodes: readonly string[];
    readonly edges: readonly DependencyEdge[];
    readonly forbiddenEdges?: readonly DependencyEdge[];
    /** Node ids that form the approved public boundary between callers and targets. */
    readonly publicInterfaces?: readonly string[];
}
export interface DependencyGateGraph {
    readonly nodes: readonly string[];
    readonly edges: readonly DependencyEdge[];
    readonly forbiddenEdges: readonly DependencyEdge[];
    readonly publicInterfaces: readonly string[];
}
export interface DependencyGateResult {
    readonly schemaId: typeof DEPENDENCY_GRAPH_BYPASS_GATE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly runId: string;
    readonly authority: DependencyGateAuthority;
    /** The observed digest is retained so replay cannot silently turn stale evidence green. */
    readonly observedAuthorityDigest: string;
    /** Complete canonical graph input required for deterministic replay. */
    readonly graph: DependencyGateGraph;
    readonly violations: readonly string[];
    readonly status: DependencyGateStatus;
    readonly diagnostics: readonly string[];
    readonly resultDigest: string;
}
export declare function compileDependencyGraphBypassGate(input: DependencyGateInput): DependencyGateResult;
export declare const createDependencyGraphBypassGate: typeof compileDependencyGraphBypassGate;
export declare function replayDependencyGraphBypassGate(result: DependencyGateResult): DependencyGateResult;
export declare function validateDependencyGraphBypassGate(result: DependencyGateResult): {
    ok: boolean;
    diagnostics: string[];
};

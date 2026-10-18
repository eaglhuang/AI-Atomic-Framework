export declare const ORACLE_ARBITRATION_SCHEMA_ID: "atm.oracleArbitration.v1";
export type OracleArbitrationStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export interface OracleAuthority {
    readonly authorityId: string;
    readonly digest: string;
    readonly sealed: boolean;
}
export interface OracleObservation {
    readonly oracleId: string;
    readonly verdict: 'pass' | 'fail' | 'unknown' | string;
    readonly evidenceDigest: string;
    readonly independent: boolean;
}
export interface OracleInput {
    readonly authority: OracleAuthority;
    readonly arbitrationId: string;
    readonly observations: readonly OracleObservation[];
    readonly sourceDigest: string;
    readonly writerRole: string;
    readonly authorityRole: string;
    readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface OracleResult {
    readonly schemaId: typeof ORACLE_ARBITRATION_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly arbitrationId: string;
    readonly authority: OracleAuthority;
    readonly observations: readonly OracleObservation[];
    readonly verdict: 'pass' | 'fail-closed';
    readonly status: OracleArbitrationStatus;
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly provenance: Readonly<Record<string, unknown>>;
    readonly resultDigest: string;
}
export declare function compileOracleArbitration(i: OracleInput): OracleResult;
export declare const createOracleArbitration: typeof compileOracleArbitration;
export declare function replayOracleArbitration(r: OracleResult): OracleResult;
export declare function validateOracleArbitration(r: OracleResult): {
    ok: boolean;
    diagnostics: string[];
};

export declare const ANTI_GAMING_CONTROL_SCHEMA_ID: "atm.antiGamingControl.v1";
export type AntiGamingStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export interface HiddenControl {
    readonly controlId: string;
    readonly seed: string;
    readonly expected: 'red' | 'green';
    readonly observed?: 'red' | 'green' | string;
}
export interface AntiGamingInput {
    readonly authority: {
        readonly authorityId: string;
        readonly digest: string;
        readonly sealed: boolean;
    };
    readonly seedCommitment: string;
    readonly controls: readonly HiddenControl[];
    readonly sourceDigest: string;
    readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface AntiGamingResult {
    readonly schemaId: typeof ANTI_GAMING_CONTROL_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly authority: AntiGamingInput['authority'];
    readonly seedCommitment: string;
    readonly controls: readonly HiddenControl[];
    readonly verdict: 'pass' | 'fail-closed';
    readonly status: AntiGamingStatus;
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly provenance: Readonly<Record<string, unknown>>;
    readonly resultDigest: string;
}
export declare function compileAntiGamingControl(i: AntiGamingInput): AntiGamingResult;
export declare const createAntiGamingControl: typeof compileAntiGamingControl;
export declare function replayAntiGamingControl(r: AntiGamingResult): AntiGamingResult;
export declare function validateAntiGamingControl(r: AntiGamingResult): {
    ok: boolean;
    diagnostics: string[];
};

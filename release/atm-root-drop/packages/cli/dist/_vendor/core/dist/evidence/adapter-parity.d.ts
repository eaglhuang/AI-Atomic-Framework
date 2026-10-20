export declare const ADAPTER_PARITY_SCHEMA_ID: "atm.adapterParityReceipt.v1";
export declare const EDITORS: readonly ["codex", "claude-code", "cursor", "copilot", "gemini", "antigravity"];
type AdapterObservation = {
    readonly editor: string;
    readonly sourceDigest?: string;
    readonly compilerDigest?: string;
    readonly manifestDigest?: string;
    readonly reinstallSmoke?: boolean;
    readonly frozenRunnerSmoke?: boolean;
};
export interface AdapterParityResult {
    readonly schemaId: typeof ADAPTER_PARITY_SCHEMA_ID;
    readonly status: 'proven' | 'blocked';
    readonly sourceDigest: string;
    readonly expectedCompilerDigests: Readonly<Record<string, string>>;
    readonly expectedManifestDigests: Readonly<Record<string, string>>;
    readonly adapters: readonly Required<AdapterObservation>[];
    readonly degraded: readonly string[];
    readonly diagnostics: readonly string[];
    readonly rollback: {
        readonly supported: true;
        readonly preservesSourceEvidence: true;
    };
    readonly resultDigest: string;
}
/**
 * Evaluates adapter parity against one sealed projection expectation.
 *
 * The expected manifest digest is per adapter because output format differs by
 * editor.  Source and compiler digests are shared, so a green adapter cannot
 * substitute its values for another adapter's projection.
 */
export declare function compileAdapterParity(input: {
    readonly sourceDigest: string;
    readonly expectedCompilerDigests: Readonly<Record<string, string>>;
    readonly expectedManifestDigests: Readonly<Record<string, string>>;
    readonly adapters?: readonly AdapterObservation[];
}): AdapterParityResult;
export declare const createAdapterParity: typeof compileAdapterParity;
export {};
